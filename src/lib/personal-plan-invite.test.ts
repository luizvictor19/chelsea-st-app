import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { Email, Mailer } from "./mail/mailer.ts";
import {
  invitePersonalPlan,
  mailPersonalPlan,
  NOT_MAILED,
  personalKey,
  type PersonalPlanDeps,
  type PersonalPlanRow,
  type WriteResult,
} from "./personal-plan-invite.ts";

function form(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    person_email: " Ana@Example.com ",
    name: "Plano da Ana",
    position: "0",
    monthly_price: "10",
    annual_price: "100",
    monthly_credits: "10",
    trail_minutes_per_day: "0",
    trial_days: "0",
    trial_credits: "0",
    credit_ceiling_months: "2",
    credit_days_after_cancel: "30",
    teacher_lesson_credits: "1",
    is_active: "on",
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

let rows: PersonalPlanRow[];
let sent: Email[];
let writeResult: WriteResult;
let mailFails: boolean;
let lines: string[];

const mailer: Mailer = {
  async send(email) {
    if (mailFails) throw new Error("Resend is down");
    sent.push(email);
  },
};

function deps(over: Partial<PersonalPlanDeps> = {}): PersonalPlanDeps {
  return {
    insert: async (row) => {
      if (writeResult.ok) rows.push(row);
      return writeResult;
    },
    mailer,
    origin: "https://app.example.com",
    newKey: () => "personal-0a0b0c0d",
    ...over,
  };
}

const log = (line: string) => lines.push(line);

beforeEach(() => {
  rows = [];
  sent = [];
  writeResult = { ok: true };
  mailFails = false;
  lines = [];
});

describe("invitePersonalPlan", () => {
  test("writes the plan for the e-mail, lower-cased, with its own key, and mails it", async () => {
    const result = await invitePersonalPlan(deps(), form(), log);
    assert.deepEqual(result, { status: "sent", email: "ana@example.com" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, "personal-0a0b0c0d");
    assert.equal(rows[0].audience, "person");
    assert.equal(rows[0].brand, "chelsea-st");
    assert.equal(rows[0].person_email, "ana@example.com");
    assert.equal(sent[0].to, "ana@example.com");
    assert.match(sent[0].text, /Plano da Ana/);
  });

  test("Resend down: the plan stays, and the screen says to send it again", async () => {
    mailFails = true;
    const result = await invitePersonalPlan(deps(), form(), log);
    assert.deepEqual(result, {
      status: "unsent",
      email: "ana@example.com",
      message: NOT_MAILED,
    });
    assert.equal(rows.length, 1);
    assert.doesNotMatch(lines.join("\n"), /ana@example\.com/);
  });

  test("no key or no site: the plan stays, and the same sentence", async () => {
    for (const over of [{ mailer: null }, { origin: null }]) {
      rows = [];
      const result = await invitePersonalPlan(deps(over), form(), log);
      assert.equal(result.status, "unsent");
      assert.equal(rows.length, 1);
    }
  });

  test("a form the database would refuse writes nothing and mails nothing", async () => {
    const result = await invitePersonalPlan(
      deps(),
      form({ person_email: "ana" }),
      log,
    );
    assert.equal(result.status, "error");
    assert.equal(rows.length + sent.length, 0);
  });

  test("a refused write mails nothing, said by its kind", async () => {
    writeResult = { ok: false, code: "23505" };
    const repeated = await invitePersonalPlan(deps(), form(), log);
    assert.equal(repeated.status, "error");
    if (repeated.status === "error") assert.match(repeated.message, /chave/);
    writeResult = { ok: false, code: "42501" };
    const other = await invitePersonalPlan(deps(), form(), log);
    if (other.status === "error") assert.match(other.message, /Tente de novo/);
    assert.equal(sent.length, 0);
  });
});

describe("mailPersonalPlan", () => {
  test("null when it went; the sentence when it did not", async () => {
    const plan = { email: "ana@example.com", name: "Plano" };
    assert.equal(await mailPersonalPlan(deps(), plan, log), null);
    mailFails = true;
    assert.equal(await mailPersonalPlan(deps(), plan, log), NOT_MAILED);
    assert.equal(
      await mailPersonalPlan({ mailer: null, origin: null }, plan, log),
      NOT_MAILED,
    );
  });
});

describe("personalKey", () => {
  test("personal- and 8 hex digits, as plans_key_shape takes it", () => {
    const key = personalKey(new Uint8Array([0, 15, 255, 16, 99]));
    assert.equal(key, "personal-000fff10");
    assert.match(key, /^[a-z][a-z0-9-]{0,39}$/);
  });
});
