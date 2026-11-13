import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { instantIn, offsetAt } from "./datetime.ts";

const SP = "America/Sao_Paulo";

describe("instantIn", () => {
  test("a local date and time in São Paulo become the right UTC instant", () => {
    // Monday 02/11/2026, 19:00 in São Paulo (UTC-3, no DST since 2019).
    assert.equal(
      instantIn("2026-11-02", "19:00", SP).toISOString(),
      "2026-11-02T22:00:00.000Z",
    );
  });

  test("works where the offset changes with the season", () => {
    // New York is UTC-5 in November and UTC-4 in July.
    assert.equal(
      instantIn("2026-11-10", "19:00", "America/New_York").toISOString(),
      "2026-11-11T00:00:00.000Z",
    );
    assert.equal(
      instantIn("2026-07-10", "19:00", "America/New_York").toISOString(),
      "2026-07-10T23:00:00.000Z",
    );
  });
});

describe("offsetAt", () => {
  test("is how far the zone is ahead of UTC at that instant", () => {
    assert.equal(
      offsetAt(new Date("2026-11-02T22:00:00Z"), SP),
      -3 * 3_600_000,
    );
    assert.equal(
      offsetAt(new Date("2026-07-10T23:00:00Z"), "America/New_York"),
      -4 * 3_600_000,
    );
  });
});
