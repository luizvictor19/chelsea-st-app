import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ErrorReport } from "../monitoring/report.ts";

import { calendarDaily, DAILY_LIMIT, DAILY_PROPOSAL_LIMIT } from "./daily.ts";

const SECRET = "c".repeat(40);
const URL = "https://app.example.com/api/calendar/daily";

function counting() {
  const limits: number[] = [];
  const reports: ErrorReport[] = [];
  return {
    limits,
    reports,
    report: async (error: ErrorReport) => {
      reports.push(error);
    },
    drain: async (limit: number) => {
      limits.push(limit);
      return { sent: 2, retry: 1, abandoned: 0 };
    },
    drainProposals: async (limit: number) => {
      limits.push(-limit);
      return { sent: 1, retry: 0, abandoned: 1 };
    },
  };
}

describe("calendarDaily", () => {
  test("without the secret: 401, and nothing is read or sent", async () => {
    const attempts: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong" },
      { authorization: SECRET },
    ];
    for (const headers of attempts) {
      const { limits, reports, drain, drainProposals, report } = counting();
      const response = await calendarDaily(new Request(URL, { headers }), {
        secret: SECRET,
        drain,
        drainProposals,
        report,
      });
      assert.equal(response.status, 401);
      assert.deepEqual(limits, []);
      assert.deepEqual(reports, []);
    }
  });

  test("with no secret set, even an empty bearer is refused", async () => {
    const { limits, drain, drainProposals, report } = counting();
    const response = await calendarDaily(
      new Request(URL, { headers: { authorization: "Bearer " } }),
      { secret: undefined, drain, drainProposals, report },
    );
    assert.equal(response.status, 401);
    assert.deepEqual(limits, []);
  });

  test("with the secret: one drain of any lesson, then of any proposal, and both reports", async () => {
    const { limits, drain, drainProposals, report } = counting();
    const response = await calendarDaily(
      new Request(URL, { headers: { authorization: `Bearer ${SECRET}` } }),
      { secret: SECRET, drain, drainProposals, report },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      sent: 2,
      retry: 1,
      abandoned: 0,
      proposals: { sent: 1, retry: 0, abandoned: 1 },
    });
    assert.deepEqual(limits, [DAILY_LIMIT, -DAILY_PROPOSAL_LIMIT]);
  });

  test("a row given up reaches the error log; a run that gave up nothing does not", async () => {
    const given = counting();
    await calendarDaily(
      new Request(URL, { headers: { authorization: `Bearer ${SECRET}` } }),
      { secret: SECRET, ...given },
    );
    assert.deepEqual(given.reports, [
      {
        kind: "job",
        route: "/api/calendar/daily",
        message: "calendar daily: 0 invites and 1 proposal e-mails abandoned",
      },
    ]);

    const reports: ErrorReport[] = [];
    await calendarDaily(
      new Request(URL, { headers: { authorization: `Bearer ${SECRET}` } }),
      {
        secret: SECRET,
        drain: async () => ({ sent: 1, retry: 0, abandoned: 0 }),
        drainProposals: async () => ({ sent: 0, retry: 0, abandoned: 0 }),
        report: async (error) => {
          reports.push(error);
        },
      },
    );
    assert.deepEqual(reports, []);
  });
});
