import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Email } from "../mail/mailer.ts";

import {
  DATABASE_DOWN_EVERY_MS,
  cleanError,
  RecordRefused,
  createReporter,
  releaseOf,
  serverErrorReport,
  type CleanError,
  type ErrorReport,
  type Recorded,
  type ReporterDeps,
} from "./report.ts";
import { describeThrown } from "./thrown.ts";

const ALERT_TO = "luiz@example.com";
const FIRST: Recorded = {
  alert: true,
  day: "2026-11-14",
  count: 1,
  firstAt: "2026-11-14T15:00:00.000Z",
  overflow: false,
};

function setup(over: Partial<ReporterDeps> = {}) {
  const recorded: CleanError[] = [];
  const sent: Email[] = [];
  const logs: string[] = [];
  let clock = 1_000_000;
  const deps: ReporterDeps = {
    production: true,
    release: "abc1234",
    record: async (error) => {
      recorded.push(error);
      return FIRST;
    },
    alertTo: ALERT_TO,
    send: async (email) => {
      sent.push(email);
    },
    now: () => clock,
    log: (line) => logs.push(line),
    ...over,
  };
  return {
    report: createReporter(deps),
    recorded,
    sent,
    logs,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const REPORT: ErrorReport = {
  kind: "server",
  route: "/teacher/[book] · render",
  message: "no profile for 3f2a9c1e-0b4d-4e8a-9f6b-2c7d1e0a5b3c",
  stack:
    "Error: no profile for 3f2a9c1e-0b4d-4e8a-9f6b-2c7d1e0a5b3c\n    at page (/var/task/page.js:1:2)",
  digest: "2830441736",
};

describe("cleanError", () => {
  test("scrubs the message, the stack and the route, and keeps the digest", () => {
    const error = cleanError(REPORT, "abc1234");
    assert.equal(error.message, "no profile for [id]");
    assert.equal(
      error.stack,
      "Error: no profile for [id]\n    at page (/var/task/page.js:1:2)",
    );
    assert.equal(error.route, "/teacher/[book] · render");
    assert.equal(error.digest, "2830441736");
    assert.equal(error.release, "abc1234");
    assert.match(error.fingerprint, /^[0-9a-f]{64}$/);
  });

  test("copies only the fields of the type: a header, a cookie or a user handed anyway never reaches the record", () => {
    const smuggled = {
      ...REPORT,
      headers: { cookie: "sb-x-auth-token=eyJabc" },
      cookies: "sb-x-auth-token=eyJabc",
      user: { email: "ana@example.com" },
    };
    // @ts-expect-error the type takes no headers, cookies nor user
    const typed: ErrorReport = { ...REPORT, headers: {} };
    assert.ok(typed);
    const error = cleanError(smuggled, null);
    assert.deepEqual(Object.keys(error).sort(), [
      "digest",
      "fingerprint",
      "kind",
      "message",
      "release",
      "route",
      "stack",
    ]);
    assert.ok(!JSON.stringify(error).includes("eyJ"));
    assert.ok(!JSON.stringify(error).includes("ana@"));
  });

  test("an unknown kind is server, a stack that is not text is none", () => {
    const error = cleanError(
      { ...REPORT, kind: "user" as never, stack: 42 as never },
      null,
    );
    assert.equal(error.kind, "server");
    assert.equal(error.stack, null);
  });
});

describe("releaseOf", () => {
  test("the first 7 hex characters of the commit, or null", () => {
    assert.equal(releaseOf("ABC1234def"), "abc1234");
    assert.equal(releaseOf(undefined), null);
    assert.equal(releaseOf("main"), null);
  });
});

describe("describeThrown and serverErrorReport", () => {
  test("an Error keeps its name beside the message, a plain Error only the message", () => {
    assert.equal(describeThrown(new TypeError("x")).message, "TypeError: x");
    assert.equal(describeThrown(new Error("x")).message, "x");
    assert.deepEqual(describeThrown("raw"), { message: "raw", stack: null });
  });

  test("the route is the pattern and the type, and the digest is kept", () => {
    const thrown = Object.assign(new Error("boom"), { digest: "123" });
    const report = serverErrorReport(thrown, {
      routePath: "/teacher/monitoring",
      routeType: "action",
    });
    assert.equal(report?.route, "/teacher/monitoring · action");
    assert.equal(report?.digest, "123");
    assert.equal(report?.kind, "server");
  });

  test("a digest that is not text is none, never the word undefined", () => {
    for (const digest of [undefined, null, 42]) {
      const thrown = Object.assign(new Error("boom"), { digest });
      assert.equal(
        serverErrorReport(thrown, { routePath: "/", routeType: "render" })
          ?.digest,
        null,
      );
    }
  });

  test("Next's redirect and notFound are no errors", () => {
    for (const digest of [
      "NEXT_REDIRECT;replace;/login;307;",
      "NEXT_HTTP_ERROR_FALLBACK;404",
      "NEXT_NOT_FOUND",
    ]) {
      const thrown = Object.assign(new Error(digest), { digest });
      assert.equal(
        serverErrorReport(thrown, { routePath: "/", routeType: "render" }),
        null,
      );
    }
  });
});

describe("createReporter", () => {
  test("outside production: the clean line in the log, nothing recorded or sent", async () => {
    const { report, recorded, sent, logs } = setup({ production: false });
    await report(REPORT);
    assert.equal(recorded.length, 0);
    assert.equal(sent.length, 0);
    assert.deepEqual(logs, [
      "app error server /teacher/[book] · render: no profile for [id] (digest 2830441736)",
    ]);
  });

  test("in production: recorded, and the alert the database asks for is e-mailed", async () => {
    const { report, recorded, sent, logs } = setup();
    await report(REPORT);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].message, "no profile for [id]");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, ALERT_TO);
    assert.equal(logs.length, 1);
  });

  test("a repeat the database does not alert about sends nothing", async () => {
    const { report, sent } = setup({
      record: async () => ({ ...FIRST, alert: false, count: 2 }),
    });
    await report(REPORT);
    assert.equal(sent.length, 0);
  });

  test("without ERROR_ALERT_TO: recorded, not sent, and a line says why", async () => {
    const { report, recorded, sent, logs } = setup({ alertTo: null });
    await report(REPORT);
    assert.equal(recorded.length, 1);
    assert.equal(sent.length, 0);
    assert.ok(
      logs.includes("app error not e-mailed: ERROR_ALERT_TO is not set"),
    );
  });

  test("the database down: an e-mail straight away, then none for 15 minutes, then again", async () => {
    const { report, sent, logs, tick } = setup({
      record: async () => {
        throw new Error("app_error_record failed: PGRST301");
      },
    });
    await report(REPORT);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /o banco não respondeu/);
    assert.ok(
      logs.includes(
        "app error not recorded: app_error_record failed: PGRST301",
      ),
    );
    tick(DATABASE_DOWN_EVERY_MS - 1);
    await report(REPORT);
    assert.equal(sent.length, 1);
    tick(1);
    await report(REPORT);
    assert.equal(sent.length, 2);
  });

  test("a row the database refused is not the database down: only the log, no e-mail", async () => {
    const { report, sent, logs } = setup({
      record: async () => {
        throw new RecordRefused("22P05");
      },
    });
    await report(REPORT);
    assert.equal(sent.length, 0);
    assert.ok(
      logs.includes("app error not recorded: app_error_record refused: 22P05"),
    );
  });

  test("the database down and no ERROR_ALERT_TO: only the log", async () => {
    const { report, sent, logs } = setup({
      alertTo: null,
      record: async () => {
        throw new Error("down");
      },
    });
    await report(REPORT);
    assert.equal(sent.length, 0);
    assert.ok(logs.includes("app error not recorded: down"));
  });

  test("never throws: a failing mailer ends in the log, scrubbed", async () => {
    const { report, logs } = setup({
      send: async () => {
        throw new Error("Resend refused: 422 ana@example.com");
      },
    });
    await assert.doesNotReject(report(REPORT));
    assert.ok(
      logs.includes(
        "app error report failed: Error: Resend refused: 422 [email]",
      ),
    );
  });

  test("never throws, even when the log itself throws", async () => {
    const { report } = setup({
      log: () => {
        throw new Error("no log");
      },
    });
    await assert.doesNotReject(report(REPORT));
  });
});
