import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  requestLink,
  type LinkLog,
  type LinkTask,
  type SendOutcome,
} from "./link-request.ts";

const EMAIL = "aluna@exemplo.com";

type Logged = { level: "error" | "warn"; args: unknown[] };

/** A log that keeps what it was given, and a schedule that keeps the task. */
function harness() {
  const logged: Logged[] = [];
  const tasks: LinkTask[] = [];
  const log: LinkLog = {
    error: (...args) => logged.push({ level: "error", args }),
    warn: (...args) => logged.push({ level: "warn", args }),
  };
  const schedule = (task: LinkTask) => {
    tasks.push(task);
  };
  const runScheduled = async () => {
    for (const task of tasks) {
      await task();
    }
  };
  return { logged, tasks, log, schedule, runScheduled };
}

// Every way GoTrue's answer can come back (src/lib/magic-link.ts, #110).
const OUTCOMES: ReadonlyArray<[string, () => Promise<SendOutcome>]> = [
  ["a link that went out", async () => null],
  ["an address without an account", async () => ({ code: "otp_disabled" })],
  ["an invite not yet accepted", async () => ({ code: "signup_disabled" })],
  [
    "the limit per address",
    async () => ({ code: "over_email_send_rate_limit", status: 429 }),
  ],
  [
    "the limit per IP",
    async () => ({ code: "over_request_rate_limit", status: 429 }),
  ],
  ["an error with no code", async () => ({})],
  [
    "an exception",
    async () => {
      throw new Error("fetch failed");
    },
  ],
];

describe("requestLink: the answer never depends on the account", () => {
  for (const flow of ["magic_link", "recovery"] as const) {
    for (const [name, send] of OUTCOMES) {
      test(`${flow}, ${name}: sent`, async () => {
        const h = harness();
        const state = requestLink({
          email: EMAIL,
          flow,
          send,
          schedule: h.schedule,
          log: h.log,
        });
        await h.runScheduled();
        assert.deepEqual(state, { status: "sent", email: EMAIL });
      });
    }
  }

  test("the answer does not wait for the send", () => {
    const h = harness();
    let started = false;
    const state = requestLink({
      email: EMAIL,
      flow: "magic_link",
      send: () => {
        started = true;
        return new Promise<SendOutcome>(() => {});
      },
      schedule: h.schedule,
      log: h.log,
    });
    // Answered before anything was sent: the send waits in the schedule.
    assert.deepEqual(state, { status: "sent", email: EMAIL });
    assert.equal(started, false);
    assert.equal(h.tasks.length, 1);
  });

  test("an address that is not one is said, and nothing is scheduled", () => {
    const h = harness();
    const state = requestLink({
      email: "aluna@exemplo",
      flow: "recovery",
      send: async () => null,
      schedule: h.schedule,
      log: h.log,
    });
    assert.deepEqual(state, {
      status: "error",
      message: "Digite um e-mail válido.",
    });
    assert.equal(h.tasks.length, 0);
  });
});

describe("requestLink: what reaches the server log", () => {
  async function logOf(send: () => Promise<SendOutcome>) {
    const h = harness();
    requestLink({
      email: EMAIL,
      flow: "magic_link",
      send,
      schedule: h.schedule,
      log: h.log,
    });
    await h.runScheduled();
    return h.logged;
  }

  test("a link that went out, or no account, logs nothing", async () => {
    assert.deepEqual(await logOf(async () => null), []);
    assert.deepEqual(await logOf(async () => ({ code: "otp_disabled" })), []);
  });

  test("the limit per address is a warning: asking twice in a minute is normal", async () => {
    const logged = await logOf(async () => ({
      code: "over_email_send_rate_limit",
      status: 429,
      message: "email rate limit exceeded",
    }));
    assert.equal(logged.length, 1);
    assert.equal(logged[0].level, "warn");
    assert.match(JSON.stringify(logged[0].args), /over_email_send_rate_limit/);
    assert.match(JSON.stringify(logged[0].args), /magic_link/);
  });

  test("a real failure is an error, with the code, the status and the message", async () => {
    const logged = await logOf(async () => ({
      code: "unexpected_failure",
      status: 500,
      message: "Error sending magic link email",
    }));
    assert.equal(logged.length, 1);
    assert.equal(logged[0].level, "error");
    const text = JSON.stringify(logged[0].args);
    assert.match(text, /unexpected_failure/);
    assert.match(text, /500/);
    assert.match(text, /Error sending magic link email/);
  });

  test("an exception is an error, and the schedule never throws", async () => {
    const logged = await logOf(async () => {
      throw new Error("fetch failed");
    });
    assert.equal(logged.length, 1);
    assert.equal(logged[0].level, "error");
    assert.match(JSON.stringify(logged[0].args), /fetch failed/);
  });

  test("something thrown that is not an Error is still logged", async () => {
    const logged = await logOf(() => Promise.reject("socket hang up"));
    assert.equal(logged.length, 1);
    assert.match(JSON.stringify(logged[0].args), /socket hang up/);
  });

  test("the address never reaches the log, even inside a message", async () => {
    const failures: Array<() => Promise<SendOutcome>> = [
      async () => ({ code: "unexpected_failure", message: `no ${EMAIL}` }),
      async () => ({
        code: "over_email_send_rate_limit",
        message: `limit for ${EMAIL.toUpperCase()}`,
      }),
      async () => {
        throw new Error(`could not send to ${EMAIL}`);
      },
    ];
    for (const send of failures) {
      const logged = await logOf(send);
      assert.equal(logged.length, 1);
      const text = JSON.stringify(logged[0].args).toLowerCase();
      assert.equal(text.includes(EMAIL), false, text);
      assert.equal(text.includes("aluna@"), false, text);
    }
  });
});
