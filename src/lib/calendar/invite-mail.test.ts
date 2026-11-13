import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { INVITE_ADDRESS } from "./ics.ts";
import {
  idempotencyKey,
  INVITE_FROM,
  inviteEmail,
  recipientEmail,
  type DueInvite,
} from "./invite-mail.ts";

const INVITE: DueInvite = {
  id: "row-1",
  lessonId: "lesson-a",
  method: "request",
  recipient: "student",
  attempts: 0,
  // 19:00 in São Paulo, 23:00 in London (GMT in November).
  scheduledAt: "2026-11-18T22:00:00Z",
  durationMinutes: 50,
  studentName: "Ana Aluna",
  studentEmail: "ana@example.com",
  teacherName: "Luiz Professor",
  teacherEmail: "agenda.luiz@example.com",
  meetUrl: "https://meet.google.com/abc-defg-hij",
  recipientTimeZone: "America/Sao_Paulo",
};

const OPTIONS = {
  appUrl: "https://app.example.com",
  now: new Date("2026-11-13T12:00:00Z"),
};

function attachedIcs(email: ReturnType<typeof inviteEmail>): string {
  const [attachment] = email.attachments ?? [];
  return Buffer.from(attachment.content, "base64").toString("utf8");
}

describe("inviteEmail", () => {
  test("the student's: to her account, the time in her zone, the Meet and her screen", () => {
    const email = inviteEmail(INVITE, OPTIONS);
    assert.equal(email.to, "ana@example.com");
    assert.equal(email.replyTo, INVITE_ADDRESS);
    assert.equal(
      email.subject,
      "Aula marcada · quarta-feira, 18 de novembro, 19:00",
    );
    assert.match(email.text, /^Olá, Ana\./);
    assert.match(
      email.text,
      /com Luiz Professor está marcada para quarta-feira, 18 de novembro, às 19:00/,
    );
    assert.match(
      email.text,
      /Entrar na aula: https:\/\/meet\.google\.com\/abc-defg-hij/,
    );
    assert.match(
      email.text,
      /use a plataforma: https:\/\/app\.example\.com\/dashboard\/lessons/,
    );
    assert.match(
      email.text,
      /Responder "Não" no convite da agenda não cancela a aula\./,
    );
  });

  test("the teacher's: to her calendar e-mail, in her zone, with her own screen", () => {
    const email = inviteEmail(
      { ...INVITE, recipient: "teacher", recipientTimeZone: "Europe/London" },
      OPTIONS,
    );
    assert.equal(email.to, "agenda.luiz@example.com");
    assert.equal(
      email.subject,
      "Aula marcada · quarta-feira, 18 de novembro, 22:00",
    );
    assert.match(email.text, /^Olá, Luiz\./);
    assert.match(email.text, /com Ana Aluna está marcada/);
    assert.match(email.text, /\/teacher\/agenda/);
  });

  test("the .ics attached is a request with both people, the same for both recipients", () => {
    const student = inviteEmail(INVITE, OPTIONS);
    const teacher = inviteEmail({ ...INVITE, recipient: "teacher" }, OPTIONS);
    const [attachment] = student.attachments ?? [];
    assert.equal(attachment.filename, "invite.ics");
    assert.equal(
      attachment.contentType,
      "text/calendar; charset=utf-8; method=REQUEST",
    );
    const ics = attachedIcs(student);
    assert.match(ics, /\r\nMETHOD:REQUEST\r\n/);
    assert.match(ics, /mailto:ana@example\.com/);
    assert.match(ics, /mailto:agenda\.luiz@example\.com/);
    assert.equal(attachedIcs(teacher), ics);
  });

  test("a cancel says so, and attaches METHOD:CANCEL", () => {
    const email = inviteEmail({ ...INVITE, method: "cancel" }, OPTIONS);
    assert.equal(
      email.subject,
      "Aula cancelada · quarta-feira, 18 de novembro, 19:00",
    );
    assert.match(email.text, /foi cancelada na plataforma/);
    assert.equal(email.text.includes("Entrar na aula"), false);
    assert.equal(
      email.attachments?.[0].contentType,
      "text/calendar; charset=utf-8; method=CANCEL",
    );
    assert.match(attachedIcs(email), /\r\nMETHOD:CANCEL\r\n/);
  });

  test("a zone the runtime does not know reads as São Paulo", () => {
    const email = inviteEmail(
      { ...INVITE, recipientTimeZone: "Mars/Olympus" },
      OPTIONS,
    );
    assert.match(email.subject, /19:00$/);
    assert.match(email.text, /fuso America\/Sao_Paulo/);
  });

  test("without a Meet, no line for it; without the teacher's address, one attendee", () => {
    const email = inviteEmail(
      { ...INVITE, meetUrl: null, teacherEmail: null },
      OPTIONS,
    );
    assert.equal(email.text.includes("Entrar na aula"), false);
    assert.equal(attachedIcs(email).match(/ATTENDEE/g)?.length, 1);
  });

  test("a row without its address is refused, never sent somewhere else", () => {
    assert.throws(
      () =>
        inviteEmail(
          { ...INVITE, recipient: "teacher", teacherEmail: null },
          OPTIONS,
        ),
      /no address/,
    );
  });

  test("the key is one per lesson, kind and person, the same on every attempt", () => {
    const email = inviteEmail(INVITE, OPTIONS);
    assert.equal(email.idempotencyKey, "lesson-lesson-a-request-student");
    assert.equal(
      idempotencyKey({ ...INVITE, attempts: 3 }),
      email.idempotencyKey,
    );
    assert.notEqual(
      idempotencyKey({ ...INVITE, method: "cancel" }),
      email.idempotencyKey,
    );
    assert.notEqual(
      idempotencyKey({ ...INVITE, recipient: "teacher" }),
      email.idempotencyKey,
    );
  });
});

describe("recipientEmail and INVITE_FROM", () => {
  test("each row goes to its own person", () => {
    assert.equal(recipientEmail(INVITE), "ana@example.com");
    assert.equal(
      recipientEmail({ ...INVITE, recipient: "teacher" }),
      "agenda.luiz@example.com",
    );
  });

  test("the sender is the brand at the platform's address", () => {
    assert.match(INVITE_FROM, /<agenda@chelsea-st\.com>$/);
  });
});
