import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MailRefused, type Email, type Mailer } from "../mail/mailer.ts";

import type { DueInvite } from "./invite-mail.ts";
import {
  drainInvites,
  failureCode,
  MAX_ATTEMPTS,
  type DrainDeps,
  type InviteQueue,
} from "./outbox.ts";

const NOW = new Date("2026-11-13T12:00:00Z");

function invite(overrides: Partial<DueInvite> = {}): DueInvite {
  return {
    id: "row-1",
    lessonId: "lesson-a",
    method: "request",
    recipient: "student",
    attempts: 0,
    scheduledAt: "2026-11-18T22:00:00Z",
    durationMinutes: 50,
    studentName: "Ana Aluna",
    studentEmail: "ana@example.com",
    teacherName: "Luiz Professor",
    teacherEmail: "agenda.luiz@example.com",
    meetUrl: "https://meet.google.com/abc-defg-hij",
    recipientTimeZone: "America/Sao_Paulo",
    ...overrides,
  };
}

/**
 * A queue in memory that keeps every write it gets. It has no lesson to
 * write: the only writes the outbox can make are these three, and the test
 * counts them.
 */
class FakeQueue implements InviteQueue {
  rows: DueInvite[];
  readonly writes: string[] = [];
  readonly asked: { lessonId: string | null; limit: number }[] = [];
  failDue = false;
  failWrites = false;

  constructor(rows: DueInvite[]) {
    this.rows = rows;
  }

  async due(lessonId: string | null, limit: number) {
    this.asked.push({ lessonId, limit });
    if (this.failDue) throw new Error("calendar_invites_due failed: 08006");
    return this.rows
      .filter((row) => lessonId === null || row.lessonId === lessonId)
      .slice(0, limit);
  }

  async sent(id: string) {
    this.writes.push(`sent ${id}`);
    if (this.failWrites) throw new Error("calendar_invite_sent failed");
    this.rows = this.rows.filter((row) => row.id !== id);
  }

  async failed(id: string, code: string, giveUp: boolean) {
    this.writes.push(`failed ${id} ${code} ${giveUp}`);
    if (this.failWrites) throw new Error("calendar_invite_failed failed");
    this.rows = this.rows.flatMap((row) =>
      row.id !== id
        ? [row]
        : giveUp
          ? []
          : [{ ...row, attempts: row.attempts + 1 }],
    );
  }
}

function mailer(answer: (email: Email) => Promise<void> = async () => {}): {
  mailer: Mailer;
  sent: Email[];
} {
  const sent: Email[] = [];
  return {
    sent,
    mailer: {
      async send(email) {
        sent.push(email);
        await answer(email);
      },
    },
  };
}

function deps(queue: InviteQueue, mail: Mailer, log: string[] = []): DrainDeps {
  return {
    queue,
    mailer: mail,
    appUrl: "https://app.example.com",
    now: () => NOW,
    log: (line) => void log.push(line),
  };
}

const refused = () =>
  Promise.reject(new MailRefused(500, "internal_server_error", "boom"));

describe("drainInvites", () => {
  test("sends each row of the lesson and marks it sent", async () => {
    const queue = new FakeQueue([
      invite(),
      invite({ id: "row-2", recipient: "teacher" }),
      invite({ id: "row-3", lessonId: "lesson-b" }),
    ]);
    const mail = mailer();
    const report = await drainInvites(deps(queue, mail.mailer), {
      lessonId: "lesson-a",
      limit: 10,
    });
    assert.deepEqual(report, { sent: 2, retry: 0, abandoned: 0 });
    assert.deepEqual(
      mail.sent.map((email) => email.to),
      ["ana@example.com", "agenda.luiz@example.com"],
    );
    assert.deepEqual(queue.writes, ["sent row-1", "sent row-2"]);
    assert.deepEqual(queue.asked, [{ lessonId: "lesson-a", limit: 10 }]);
  });

  test("rows of a lesson just tried are skipped in the same go", async () => {
    const queue = new FakeQueue([
      invite(),
      invite({ id: "row-2", lessonId: "lesson-b" }),
    ]);
    const report = await drainInvites(deps(queue, mailer().mailer), {
      lessonId: null,
      limit: 10,
      skipLessonId: "lesson-a",
    });
    assert.deepEqual(report, { sent: 1, retry: 0, abandoned: 0 });
    assert.deepEqual(queue.writes, ["sent row-2"]);
  });

  test("a send that fails leaves the row pending with its code and one attempt, and writes nothing else", async () => {
    const queue = new FakeQueue([invite()]);
    const log: string[] = [];
    const report = await drainInvites(
      deps(queue, mailer(refused).mailer, log),
      { lessonId: "lesson-a", limit: 10 },
    );
    assert.deepEqual(report, { sent: 0, retry: 1, abandoned: 0 });
    assert.deepEqual(queue.writes, [
      "failed row-1 resend_500_internal_server_error false",
    ]);
    assert.equal(queue.rows[0].attempts, 1);
    assert.deepEqual(log, [
      "calendar invite lesson-a request student: resend_500_internal_server_error",
    ]);
  });

  test("the next attempt sends it and marks it sent, under the same key", async () => {
    const queue = new FakeQueue([invite()]);
    const first = mailer(refused);
    await drainInvites(deps(queue, first.mailer), {
      lessonId: null,
      limit: 10,
    });
    const second = mailer();
    const report = await drainInvites(deps(queue, second.mailer), {
      lessonId: null,
      limit: 10,
    });
    assert.deepEqual(report, { sent: 1, retry: 0, abandoned: 0 });
    assert.equal(queue.writes.at(-1), "sent row-1");
    assert.equal(
      first.sent[0].idempotencyKey,
      "lesson-lesson-a-request-student",
    );
    assert.equal(second.sent[0].idempotencyKey, first.sent[0].idempotencyKey);
  });

  test(`the ${MAX_ATTEMPTS}th failure abandons the row`, async () => {
    const queue = new FakeQueue([invite()]);
    const reports = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      reports.push(
        await drainInvites(deps(queue, mailer(refused).mailer), {
          lessonId: null,
          limit: 10,
        }),
      );
    }
    assert.deepEqual(reports.at(-2), { sent: 0, retry: 1, abandoned: 0 });
    assert.deepEqual(reports.at(-1), { sent: 0, retry: 0, abandoned: 1 });
    assert.equal(
      queue.writes.at(-1),
      "failed row-1 resend_500_internal_server_error true",
    );
    assert.deepEqual(queue.rows, []);
  });

  test("a request whose lesson started is abandoned without a send", async () => {
    const queue = new FakeQueue([
      invite({ scheduledAt: "2026-11-13T11:30:00Z" }),
    ]);
    const mail = mailer();
    const report = await drainInvites(deps(queue, mail.mailer), {
      lessonId: null,
      limit: 10,
    });
    assert.deepEqual(report, { sent: 0, retry: 0, abandoned: 1 });
    assert.deepEqual(mail.sent, []);
    assert.deepEqual(queue.writes, ["failed row-1 lesson_started true"]);
  });

  test("a cancel still goes during the lesson, and is abandoned after its end", async () => {
    const during = new FakeQueue([
      invite({ method: "cancel", scheduledAt: "2026-11-13T11:30:00Z" }),
    ]);
    const mail = mailer();
    await drainInvites(deps(during, mail.mailer), {
      lessonId: null,
      limit: 10,
    });
    assert.deepEqual(during.writes, ["sent row-1"]);
    assert.equal(mail.sent.length, 1);

    const after = new FakeQueue([
      invite({ method: "cancel", scheduledAt: "2026-11-13T11:00:00Z" }),
    ]);
    await drainInvites(deps(after, mailer().mailer), {
      lessonId: null,
      limit: 10,
    });
    assert.deepEqual(after.writes, ["failed row-1 lesson_ended true"]);
  });

  test("a row without its address is abandoned without a send", async () => {
    const queue = new FakeQueue([
      invite({ recipient: "teacher", teacherEmail: null }),
    ]);
    const mail = mailer();
    await drainInvites(deps(queue, mail.mailer), { lessonId: null, limit: 10 });
    assert.deepEqual(mail.sent, []);
    assert.deepEqual(queue.writes, ["failed row-1 no_address true"]);
  });

  test("the queue failing is logged and never thrown", async () => {
    const queue = new FakeQueue([invite()]);
    queue.failDue = true;
    const log: string[] = [];
    const report = await drainInvites(deps(queue, mailer().mailer, log), {
      lessonId: null,
      limit: 10,
    });
    assert.deepEqual(report, { sent: 0, retry: 0, abandoned: 0 });
    assert.deepEqual(log, [
      "calendar invites not read: calendar_invites_due failed: 08006",
    ]);

    const writes = new FakeQueue([invite(), invite({ id: "row-2" })]);
    writes.failWrites = true;
    const lines: string[] = [];
    const first = mailer(async (email) =>
      email.to === "ana@example.com" && lines.length === 0
        ? undefined
        : refused(),
    );
    await drainInvites(deps(writes, first.mailer, lines), {
      lessonId: null,
      limit: 10,
    });
    assert.deepEqual(lines, [
      "calendar invite lesson-a request student: sent, not marked: calendar_invite_sent failed",
      "calendar invite lesson-a request student: resend_500_internal_server_error",
      "calendar invite lesson-a request student: not recorded: calendar_invite_failed failed",
    ]);
  });

  test("the log carries no address and no name", async () => {
    const queue = new FakeQueue([
      invite(),
      invite({ id: "row-2", recipient: "teacher", teacherEmail: null }),
    ]);
    const log: string[] = [];
    await drainInvites(deps(queue, mailer(refused).mailer, log), {
      lessonId: null,
      limit: 10,
    });
    assert.equal(log.length, 2);
    for (const line of log) {
      assert.doesNotMatch(line, /@|Ana|Luiz|Aluna|Professor/);
    }
  });
});

describe("failureCode", () => {
  test("names Resend's refusal, a timeout, and anything else", () => {
    assert.equal(
      failureCode(
        new MailRefused(422, "validation_error", "to: ana@example.com"),
      ),
      "resend_422_validation_error",
    );
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    assert.equal(failureCode(timeout), "timeout");
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    assert.equal(failureCode(aborted), "timeout");
    assert.equal(failureCode(new TypeError("fetch failed")), "send_error");
    assert.equal(failureCode("odd"), "send_error");
  });
});
