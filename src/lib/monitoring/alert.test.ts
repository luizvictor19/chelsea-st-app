import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { databaseDownEmail, errorAlertEmail } from "./alert.ts";
import type { CleanError, Recorded } from "./report.ts";

const ERROR: CleanError = {
  fingerprint: "a".repeat(64),
  kind: "job",
  route: "/api/asaas/webhook",
  message: "asaas webhook: set aside: unknown subscription sub_1",
  stack: "Error: x\n    at f (a.js:1:2)",
  digest: null,
  release: "abc1234",
};

const RECORDED: Recorded = {
  alert: true,
  day: "2026-11-14",
  count: 1,
  firstAt: "2026-11-14T15:04:00.000Z",
  overflow: false,
};

describe("errorAlertEmail", () => {
  test("the subject names the kind, the route and the start of the message", () => {
    const email = errorAlertEmail("luiz@example.com", ERROR, RECORDED);
    assert.equal(
      email.subject,
      "[erro] job /api/asaas/webhook: asaas webhook: set aside: unknown subscription sub_1",
    );
    assert.equal(email.to, "luiz@example.com");
  });

  test("a long message in one line, cut in the subject", () => {
    const email = errorAlertEmail(
      "luiz@example.com",
      { ...ERROR, message: `a\nb ${"x".repeat(200)}` },
      RECORDED,
    );
    assert.ok(!email.subject.includes("\n"));
    assert.ok(email.subject.endsWith("…"));
  });

  test("the body: message, route, release, digest, count, when, and the query; no stack", () => {
    const { text } = errorAlertEmail("luiz@example.com", ERROR, RECORDED);
    assert.match(text, /Mensagem: asaas webhook: set aside/);
    assert.match(text, /Rota: \/api\/asaas\/webhook/);
    assert.match(text, /Release: abc1234/);
    assert.match(text, /Digest: \(sem digest\)/);
    assert.match(text, /Vezes hoje: 1/);
    assert.match(
      text,
      /Primeira vez: 14\/11\/2026, 12:04 \(horário de Brasília\)/,
    );
    assert.match(
      text,
      new RegExp(
        `select \\* from app_errors where fingerprint = '${"a".repeat(64)}' and day = '2026-11-14';`,
      ),
    );
    assert.ok(!text.includes("at f (a.js"));
  });

  test("one key per error per day", () => {
    assert.equal(
      errorAlertEmail("luiz@example.com", ERROR, RECORDED).idempotencyKey,
      `app-error-${"a".repeat(64)}-2026-11-14`,
    );
  });
});

describe("databaseDownEmail", () => {
  test("says the database did not answer, with the error it could not keep", () => {
    const now = Date.parse("2026-11-14T15:04:00.000Z");
    const email = databaseDownEmail("luiz@example.com", ERROR, "PGRST301", now);
    assert.equal(
      email.subject,
      "[erro] o banco não respondeu ao registrar um erro",
    );
    assert.match(email.text, /Resposta do banco: PGRST301/);
    assert.match(email.text, /Rota: \/api\/asaas\/webhook/);
    assert.equal(
      email.idempotencyKey,
      `app-error-database-down-${Math.floor(now / 900_000)}`,
    );
  });
});
