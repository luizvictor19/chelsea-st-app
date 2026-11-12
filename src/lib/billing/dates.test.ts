import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addCycle,
  addDays,
  billingDay,
  daysBetween,
  firstDueOn,
  paidThroughOf,
} from "./dates.ts";

describe("billing dates", () => {
  test("the day is São Paulo's, also near midnight", () => {
    // 02h59 UTC is still the day before in São Paulo (UTC-3).
    assert.equal(billingDay(new Date("2026-11-13T02:59:00Z")), "2026-11-12");
    assert.equal(billingDay(new Date("2026-11-13T03:00:00Z")), "2026-11-13");
  });

  test("a 14 day trial charges on day 15, the day plus 14", () => {
    assert.equal(firstDueOn("2026-11-12", 14), "2026-11-26");
    assert.equal(firstDueOn("2026-12-25", 14), "2027-01-08");
    assert.equal(firstDueOn("2026-11-12", 0), "2026-11-12");
  });

  test("refuses trial days that are not a whole number", () => {
    assert.throws(() => firstDueOn("2026-11-12", -1));
    assert.throws(() => firstDueOn("2026-11-12", 1.5));
    assert.throws(() => addDays("12/11/2026", 1), /Not a day/);
  });

  test("a cycle keeps the day, held to a shorter month", () => {
    assert.equal(addCycle("2026-11-26", "monthly"), "2026-12-26");
    assert.equal(addCycle("2027-01-31", "monthly"), "2027-02-28");
    assert.equal(addCycle("2028-01-31", "monthly"), "2028-02-29");
    assert.equal(addCycle("2026-12-15", "monthly"), "2027-01-15");
    assert.equal(addCycle("2028-02-29", "annual"), "2029-02-28");
    assert.equal(addCycle("2026-11-26", "annual"), "2027-11-26");
  });

  test("a charge pays through the day before the next one", () => {
    assert.equal(paidThroughOf("2026-11-26", "monthly"), "2026-12-25");
    assert.equal(paidThroughOf("2026-11-26", "annual"), "2027-11-25");
  });

  test("days between two days", () => {
    assert.equal(daysBetween("2026-11-26", "2026-11-27"), 1);
    assert.equal(daysBetween("2026-11-26", "2026-12-03"), 7);
    assert.equal(daysBetween("2026-11-27", "2026-11-26"), -1);
  });
});
