import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createFakeStore } from "../billing/fake.ts";

import { runDaily } from "./daily.ts";

const OVERDUE = { taken: 1, outcomes: { pix_reminder: 1 } };

describe("runDaily", () => {
  test("runs the credits where billing is not open, and says the overdue was skipped", async () => {
    const store = createFakeStore();
    store.dailyReport = { granted: 2, closed: 5 };
    const report = await runDaily({
      credits: () => store.creditDaily(),
      overdue: null,
      log: () => {},
    });
    assert.deepEqual(report, {
      credits: { granted: 2, closed: 5 },
      overdue: { skipped: "billing is not open here" },
    });
  });

  test("a failure of the credits is logged and the overdue still runs", async () => {
    const logged: string[] = [];
    let overdueRan = false;
    const report = await runDaily({
      credits: async () => {
        throw new Error("credit_daily failed: 57014 canceling statement");
      },
      overdue: async () => {
        overdueRan = true;
        return OVERDUE;
      },
      log: (line) => logged.push(line),
    });
    assert.equal(overdueRan, true);
    assert.deepEqual(report.overdue, OVERDUE);
    assert.deepEqual(report.credits, {
      error: "credit_daily failed: 57014 canceling statement",
    });
    assert.deepEqual(logged, [
      "credits daily failed: credit_daily failed: 57014 canceling statement",
    ]);
  });

  test("a failure that is not an Error is kept as text", async () => {
    const report = await runDaily({
      credits: () => Promise.reject("no service role key"),
      overdue: null,
      log: () => {},
    });
    assert.deepEqual(report.credits, { error: "no service role key" });
  });

  test("the credits run before the overdue", async () => {
    const order: string[] = [];
    await runDaily({
      credits: async () => {
        order.push("credits");
        return { granted: 0, closed: 0 };
      },
      overdue: async () => {
        order.push("overdue");
        return OVERDUE;
      },
      log: () => {},
    });
    assert.deepEqual(order, ["credits", "overdue"]);
  });
});
