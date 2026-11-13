import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MAX_ATTEMPTS } from "../../calendar/outbox.ts";
import { MailRefused, type Email, type Mailer } from "../../mail/mailer.ts";

import {
  drainProposalMails,
  type ProposalDrainDeps,
  type ProposalMailQueue,
} from "./outbox.ts";
import type { DueProposalMail } from "./proposal-mail.ts";

function mail(overrides: Partial<DueProposalMail> = {}): DueProposalMail {
  return {
    id: "row-1",
    proposalId: "proposal-a",
    recipient: "student",
    attempts: 0,
    recipientEmail: "ana@example.com",
    recipientName: "Ana Aluna",
    recipientTimeZone: "America/Sao_Paulo",
    proposerName: "Luiz Professor",
    startsAt: ["2026-11-16T22:00:00Z"],
    durationMinutes: 50,
    expiresAt: "2026-11-16T21:00:00Z",
    ...overrides,
  };
}

/** A queue in memory that keeps every write it gets. */
class FakeQueue implements ProposalMailQueue {
  rows: DueProposalMail[];
  readonly writes: string[] = [];
  readonly asked: { proposalId: string | null; limit: number }[] = [];
  failDue = false;
  failWrites = false;

  constructor(rows: DueProposalMail[]) {
    this.rows = rows;
  }

  async due(proposalId: string | null, limit: number) {
    this.asked.push({ proposalId, limit });
    if (this.failDue)
      throw new Error("lesson_proposal_mails_due failed: 08006");
    return this.rows
      .filter((row) => proposalId === null || row.proposalId === proposalId)
      .slice(0, limit);
  }

  async sent(id: string) {
    this.writes.push(`sent ${id}`);
    if (this.failWrites) throw new Error("lesson_proposal_mail_sent failed");
    this.rows = this.rows.filter((row) => row.id !== id);
  }

  async failed(id: string, code: string, giveUp: boolean, tried: boolean) {
    this.writes.push(`failed ${id} ${code} ${giveUp} ${tried}`);
    if (this.failWrites) throw new Error("lesson_proposal_mail_failed failed");
    this.rows = this.rows.flatMap((row) =>
      row.id !== id
        ? [row]
        : giveUp
          ? []
          : [{ ...row, attempts: row.attempts + (tried ? 1 : 0) }],
    );
  }
}

class FakeMailer implements Mailer {
  readonly sent: Email[] = [];
  failures: unknown[] = [];

  async send(email: Email) {
    const failure = this.failures.shift();
    if (failure !== undefined) throw failure;
    this.sent.push(email);
  }
}

function deps(queue: FakeQueue, mailer: FakeMailer, lines: string[]) {
  let pauses = 0;
  const value: ProposalDrainDeps = {
    queue,
    mailer,
    appUrl: "https://app.example.com",
    log: (line) => lines.push(line),
    pause: async () => {
      pauses++;
    },
  };
  return { value, pauses: () => pauses };
}

describe("drainProposalMails", () => {
  test("sends each row and marks it, pausing between sends", async () => {
    const queue = new FakeQueue([
      mail(),
      mail({ id: "row-2", proposalId: "proposal-b", recipient: "teacher" }),
    ]);
    const mailer = new FakeMailer();
    const lines: string[] = [];
    const d = deps(queue, mailer, lines);
    const report = await drainProposalMails(d.value, {
      proposalId: null,
      limit: 10,
    });
    assert.deepEqual(report, { sent: 2, retry: 0, abandoned: 0 });
    assert.deepEqual(queue.writes, ["sent row-1", "sent row-2"]);
    assert.equal(d.pauses(), 1);
    assert.deepEqual(queue.asked, [{ proposalId: null, limit: 10 }]);
  });

  test("a failure keeps the row with its code; a new try sends under the same key; the fifth gives up", async () => {
    const queue = new FakeQueue([mail()]);
    const mailer = new FakeMailer();
    const lines: string[] = [];
    mailer.failures = [new MailRefused(500, "internal_server_error", "boom")];
    const first = await drainProposalMails(deps(queue, mailer, lines).value, {
      proposalId: "proposal-a",
      limit: 1,
    });
    assert.deepEqual(first, { sent: 0, retry: 1, abandoned: 0 });
    assert.deepEqual(queue.writes, [
      "failed row-1 resend_500_internal_server_error false true",
    ]);

    const retried = new FakeMailer();
    await drainProposalMails(deps(queue, retried, lines).value, {
      proposalId: "proposal-a",
      limit: 1,
    });
    assert.equal(retried.sent.length, 1);
    assert.equal(retried.sent[0].idempotencyKey, "proposal-proposal-a-student");

    const last = new FakeQueue([mail({ attempts: MAX_ATTEMPTS - 1 })]);
    const failing = new FakeMailer();
    failing.failures = [new Error("socket hang up")];
    const report = await drainProposalMails(deps(last, failing, lines).value, {
      proposalId: null,
      limit: 1,
    });
    assert.deepEqual(report, { sent: 0, retry: 0, abandoned: 1 });
    assert.deepEqual(last.writes, ["failed row-1 send_error true true"]);
  });

  test("a row without an address is given up without a send or an attempt", async () => {
    const queue = new FakeQueue([mail({ recipientEmail: null })]);
    const mailer = new FakeMailer();
    const report = await drainProposalMails(deps(queue, mailer, []).value, {
      proposalId: null,
      limit: 5,
    });
    assert.deepEqual(report, { sent: 0, retry: 0, abandoned: 1 });
    assert.deepEqual(queue.writes, ["failed row-1 no_address true false"]);
    assert.equal(mailer.sent.length, 0);
  });

  test("a queue that cannot be read, or written, never throws", async () => {
    const queue = new FakeQueue([mail()]);
    queue.failDue = true;
    const lines: string[] = [];
    assert.deepEqual(
      await drainProposalMails(deps(queue, new FakeMailer(), lines).value, {
        proposalId: null,
        limit: 5,
      }),
      { sent: 0, retry: 0, abandoned: 0 },
    );
    queue.failDue = false;
    queue.failWrites = true;
    const failing = new FakeMailer();
    failing.failures = [new Error("down")];
    await drainProposalMails(deps(queue, failing, lines).value, {
      proposalId: null,
      limit: 5,
    });
    const report = await drainProposalMails(
      deps(queue, new FakeMailer(), lines).value,
      { proposalId: null, limit: 5 },
    );
    assert.deepEqual(report, { sent: 1, retry: 0, abandoned: 0 });
    assert.ok(lines.some((line) => line.includes("not read")));
    assert.ok(lines.some((line) => line.includes("not recorded")));
    assert.ok(lines.some((line) => line.includes("sent, not marked")));
  });

  test("the log carries the proposal, the side and a code, never an address or a name", async () => {
    const queue = new FakeQueue([
      mail(),
      mail({ id: "row-2", recipientEmail: null }),
    ]);
    const mailer = new FakeMailer();
    mailer.failures = [
      new MailRefused(422, "validation_error", "ana@example.com is invalid"),
    ];
    const lines: string[] = [];
    await drainProposalMails(deps(queue, mailer, lines).value, {
      proposalId: null,
      limit: 5,
    });
    assert.ok(lines.length >= 2);
    for (const line of lines) {
      assert.doesNotMatch(line, /@|Ana|Luiz/);
      assert.match(line, /^proposal mail proposal-a student: /);
    }
  });
});
