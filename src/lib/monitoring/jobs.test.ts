import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  calendarFailure,
  creditsFailure,
  planFailure,
  webhookFailure,
  webhookNotConfigured,
} from "./jobs.ts";

const NONE = { sent: 0, retry: 0, abandoned: 0 };

describe("webhookFailure", () => {
  test("an event set aside is reported, though Asaas got a 200", () => {
    assert.deepEqual(
      webhookFailure({
        status: 200,
        note: "set aside: unknown subscription sub_1",
      }),
      {
        kind: "job",
        route: "/api/asaas/webhook",
        message: "asaas webhook 200: set aside: unknown subscription sub_1",
      },
    );
  });

  test("a 500 is reported", () => {
    assert.equal(
      webhookFailure({ status: 500, note: "store down" })?.message,
      "asaas webhook 500: store down",
    );
  });

  test("a handled event, a wrong token or a repeat is not", () => {
    for (const result of [
      { status: 200, note: "subscription sub_1 read" },
      { status: 401, note: "wrong token" },
      { status: 200, note: "already handled" },
    ] as const) {
      assert.equal(webhookFailure(result), null);
    }
  });

  test("not configured is reported with the cause", () => {
    assert.equal(
      webhookNotConfigured(new Error("ASAAS_API_KEY is empty")).message,
      "asaas webhook: not configured: ASAAS_API_KEY is empty",
    );
  });
});

describe("creditsFailure", () => {
  test("the credits' error is reported", () => {
    assert.deepEqual(
      creditsFailure({
        credits: { error: "credit_daily failed: 57014" },
        overdue: { skipped: "billing is not open here" },
      }),
      {
        kind: "job",
        route: "/api/billing/daily",
        message: "credits daily failed: credit_daily failed: 57014",
      },
    );
  });

  test("a run that closed its lots is not", () => {
    assert.equal(
      creditsFailure({
        credits: { granted: 0, closed: 2 },
        overdue: { skipped: "billing is not open here" },
      }),
      null,
    );
  });
});

describe("calendarFailure", () => {
  test("an invite or a proposal e-mail given up is reported", () => {
    assert.equal(
      calendarFailure({ ...NONE, abandoned: 2 }, NONE)?.message,
      "calendar daily: 2 invites and 0 proposal e-mails abandoned",
    );
    assert.equal(
      calendarFailure(NONE, { ...NONE, abandoned: 1 })?.route,
      "/api/calendar/daily",
    );
  });

  test("a run that gave up nothing is not", () => {
    assert.equal(calendarFailure({ ...NONE, sent: 3, retry: 1 }, NONE), null);
  });
});

describe("planFailure", () => {
  test("names the step and the cause, never the person", () => {
    const report = planFailure("pix", new TypeError("fetch failed"));
    assert.equal(report.route, "/dashboard/plano");
    assert.equal(report.message, "plano pix: TypeError: fetch failed");
    assert.match(String(report.stack), /TypeError: fetch failed/);
  });
});
