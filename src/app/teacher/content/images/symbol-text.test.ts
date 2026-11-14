import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { symbolTextOf } from "./symbol-text.ts";

describe("symbolTextOf", () => {
  test("keeps the character the teacher typed, trimmed", () => {
    assert.equal(symbolTextOf("5"), "5");
    assert.equal(symbolTextOf("  12th "), "12th");
    assert.equal(symbolTextOf("2 + 2 = 4"), "2 + 2 = 4");
  });

  test("an empty or blank field is no character, never a blank one", () => {
    assert.equal(symbolTextOf(""), null);
    assert.equal(symbolTextOf("   "), null);
  });
});
