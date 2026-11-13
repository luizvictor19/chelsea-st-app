import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  answerPath,
  proposalEmail,
  proposalIdempotencyKey,
  type DueProposalMail,
} from "./proposal-mail.ts";

const APP = "https://app.example.com";

const TO_STUDENT: DueProposalMail = {
  id: "row-1",
  proposalId: "proposal-a",
  recipient: "student",
  attempts: 0,
  recipientEmail: "ana@example.com",
  recipientName: "Ana Aluna",
  recipientTimeZone: "America/Sao_Paulo",
  proposerName: "Luiz Professor",
  // Monday 16/11 and Wednesday 18/11/2026, 19:00 in São Paulo.
  startsAt: ["2026-11-16T22:00:00Z", "2026-11-18T22:00:00Z"],
  durationMinutes: 50,
  expiresAt: "2026-11-16T21:00:00Z",
};

const TO_TEACHER: DueProposalMail = {
  ...TO_STUDENT,
  id: "row-2",
  proposalId: "proposal-b",
  recipient: "teacher",
  recipientEmail: "agenda.luiz@example.com",
  recipientName: "Luiz Professor",
  recipientTimeZone: "Europe/London",
  proposerName: "Ana Aluna",
  startsAt: ["2026-11-20T11:15:00Z"],
};

describe("proposalEmail", () => {
  test("to the student: every lesson of the series in her zone, and her screen", () => {
    const email = proposalEmail(TO_STUDENT, { appUrl: APP });
    assert.equal(email.to, "ana@example.com");
    assert.equal(
      email.subject,
      "Proposta de aula · segunda-feira, 16 de novembro, 19:00 e mais 1",
    );
    assert.match(email.text, /^Olá, Ana\./);
    assert.match(email.text, /Luiz Professor propôs uma série de 2 aulas/);
    assert.match(email.text, /- segunda-feira, 16 de novembro, às 19:00/);
    assert.match(email.text, /- quarta-feira, 18 de novembro, às 19:00/);
    assert.match(email.text, /fuso America\/Sao_Paulo/);
    assert.match(email.text, /custo da aula do seu plano/);
    assert.match(
      email.text,
      /vale até segunda-feira, 16 de novembro, às 18:00/,
    );
    assert.match(email.text, /https:\/\/app\.example\.com\/dashboard$/m);
    assert.equal(email.replyTo, "agenda@chelsea-st.com");
    assert.equal(email.attachments, undefined);
  });

  test("to the teacher: her calendar e-mail, her zone, her agenda", () => {
    const email = proposalEmail(TO_TEACHER, { appUrl: APP });
    assert.equal(email.to, "agenda.luiz@example.com");
    // 11:15 UTC is 11:15 in London in November.
    assert.equal(
      email.subject,
      "Proposta de aula · sexta-feira, 20 de novembro, 11:15",
    );
    assert.match(email.text, /Ana Aluna propôs uma aula de inglês de 50 min/);
    assert.match(email.text, /fuso Europe\/London/);
    assert.match(email.text, /saldo do aluno/);
    assert.match(email.text, /https:\/\/app\.example\.com\/teacher\/agenda$/m);
  });

  test("a zone the runtime does not know reads as São Paulo", () => {
    const email = proposalEmail(
      { ...TO_STUDENT, recipientTimeZone: "Mars/Olympus" },
      { appUrl: APP },
    );
    assert.match(email.text, /fuso America\/Sao_Paulo/);
  });

  test("a row without its address is refused, never sent somewhere else", () => {
    assert.throws(
      () =>
        proposalEmail({ ...TO_STUDENT, recipientEmail: null }, { appUrl: APP }),
      /no address/,
    );
  });

  test("one key per proposal and person, the same on every attempt", () => {
    assert.equal(
      proposalIdempotencyKey(TO_STUDENT),
      "proposal-proposal-a-student",
    );
    assert.equal(
      proposalEmail({ ...TO_STUDENT, attempts: 3 }, { appUrl: APP })
        .idempotencyKey,
      proposalEmail(TO_STUDENT, { appUrl: APP }).idempotencyKey,
    );
    assert.notEqual(
      proposalIdempotencyKey(TO_STUDENT),
      proposalIdempotencyKey({ ...TO_STUDENT, recipient: "teacher" }),
    );
  });

  test("each side answers on its own screen", () => {
    assert.equal(answerPath("student"), "/dashboard");
    assert.equal(answerPath("teacher"), "/teacher/agenda");
  });
});
