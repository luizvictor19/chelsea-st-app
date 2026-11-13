import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cronAuthorized } from "./cron-auth.ts";

const SECRET = "s".repeat(32);

describe("cronAuthorized", () => {
  test("the bearer of the secret passes", () => {
    assert.equal(cronAuthorized(`Bearer ${SECRET}`, SECRET), true);
  });

  test("no header, another secret or the secret without Bearer does not", () => {
    assert.equal(cronAuthorized(null, SECRET), false);
    assert.equal(cronAuthorized(`Bearer ${"t".repeat(32)}`, SECRET), false);
    assert.equal(cronAuthorized(SECRET, SECRET), false);
    assert.equal(cronAuthorized(`Bearer ${SECRET}x`, SECRET), false);
  });

  test("a secret unset or under 32 characters lets nobody in", () => {
    assert.equal(cronAuthorized("Bearer ", undefined), false);
    assert.equal(cronAuthorized("Bearer short", "short"), false);
    assert.equal(cronAuthorized("Bearer ", ""), false);
  });
});
