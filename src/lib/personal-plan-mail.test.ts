import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { AGENDA_ADDRESS } from "./mail/senders.ts";
import { PERSONAL_PLAN_FROM, personalPlanEmail } from "./personal-plan-mail.ts";

const MAIL = personalPlanEmail({
  to: "ana+plano@example.com",
  planName: "Plano da Ana",
  origin: "https://app.example.com",
});

describe("personalPlanEmail", () => {
  test("its subject, from and back to agenda@", () => {
    assert.equal(MAIL.subject, "Seu plano personalizado está pronto");
    assert.equal(MAIL.to, "ana+plano@example.com");
    assert.equal(MAIL.replyTo, AGENDA_ADDRESS);
    assert.match(PERSONAL_PLAN_FROM, /<agenda@chelsea-st\.com>$/);
  });

  test("names the plan and the address it is for, and says no number", () => {
    assert.match(MAIL.text, /Plano da Ana/);
    assert.match(MAIL.text, /este mesmo e-mail, ana\+plano@example\.com,/);
    const withoutLinks = MAIL.text.replace(/https:\/\/\S+/g, "");
    assert.doesNotMatch(withoutLinks, /\d/);
  });

  test("two links: the login, and the signup with the address in the fragment, never in the query", () => {
    assert.match(MAIL.text, /Entre: https:\/\/app\.example\.com\/login\n/);
    const signup = /Crie a sua conta: (\S+)/.exec(MAIL.text)?.[1] ?? "";
    const url = new URL(signup);
    assert.equal(url.origin + url.pathname, "https://app.example.com/cadastro");
    assert.equal(url.search, "");
    assert.equal(url.hash, "#email=ana%2Bplano%40example.com");
  });
});
