import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { creditsText, lastDayOf, summarize } from "./summary.ts";

// Midnight in São Paulo (UTC-3) of 26/11/2026, as Postgres writes it.
const NOV_26 = "2026-11-26T03:00:00+00:00";
const DEC_26 = "2026-12-26T03:00:00+00:00";

describe("lastDayOf", () => {
  test("a lot that expires at midnight is used until the day before", () => {
    assert.equal(lastDayOf(NOV_26), "2026-11-25");
    assert.equal(lastDayOf("2026-03-01T03:00:00Z"), "2026-02-28");
  });

  test("refuses what is not a timestamp", () => {
    assert.throws(() => lastDayOf("amanhã"), /Not a timestamp/);
  });
});

describe("summarize", () => {
  test("no lot: a balance of 0 and nothing ending", () => {
    assert.deepEqual(summarize([]), { balance: 0, next: null, lasting: 0 });
  });

  test("the balance and the credits that end first, summed by day", () => {
    assert.deepEqual(
      summarize([
        { remaining: 10, expiresAt: DEC_26 },
        { remaining: 3, expiresAt: NOV_26 },
        { remaining: 2, expiresAt: "2026-11-26T03:00:00.000Z" },
      ]),
      { balance: 15, next: { credits: 5, lastDay: "2026-11-25" }, lasting: 0 },
    );
  });

  test("an empty lot neither counts nor names the day", () => {
    assert.deepEqual(
      summarize([
        { remaining: 0, expiresAt: NOV_26 },
        { remaining: 4, expiresAt: DEC_26 },
      ]),
      { balance: 4, next: { credits: 4, lastDay: "2026-12-25" }, lasting: 0 },
    );
  });

  test("a lot without an end counts in the balance and names no day", () => {
    assert.deepEqual(
      summarize([
        { remaining: 10, expiresAt: null },
        { remaining: 3, expiresAt: NOV_26 },
      ]),
      { balance: 13, next: { credits: 3, lastDay: "2026-11-25" }, lasting: 10 },
    );
    assert.deepEqual(summarize([{ remaining: 8, expiresAt: null }]), {
      balance: 8,
      next: null,
      lasting: 8,
    });
  });
});

describe("creditsText", () => {
  test("one is singular, the rest plural", () => {
    assert.equal(creditsText(1), "1 crédito");
    assert.equal(creditsText(0), "0 créditos");
    assert.equal(creditsText(12), "12 créditos");
  });
});
