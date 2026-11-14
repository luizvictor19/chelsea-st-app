import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { markArrival, takeArrival } from "./arrival.ts";

describe("arrival", () => {
  test("the marked row takes its arrival once", () => {
    markArrival("linha-palavra-a");
    assert.equal(takeArrival("linha-palavra-a"), true);
    assert.equal(takeArrival("linha-palavra-a"), false);
  });

  test("another row does not take it, and leaves it for the right one", () => {
    markArrival("linha-cena-b");
    assert.equal(takeArrival("linha-palavra-b"), false);
    assert.equal(takeArrival("linha-cena-b"), true);
  });

  test("a later mark replaces an earlier one", () => {
    markArrival("linha-palavra-c");
    markArrival("linha-palavra-d");
    assert.equal(takeArrival("linha-palavra-c"), false);
    assert.equal(takeArrival("linha-palavra-d"), true);
  });

  test("nothing marked, nothing taken", () => {
    assert.equal(takeArrival("linha-palavra-e"), false);
  });
});
