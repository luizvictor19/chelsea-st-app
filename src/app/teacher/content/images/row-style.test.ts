import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { rowClass } from "./row-style.ts";

describe("rowClass", () => {
  test("outlines the chosen row in the accent colour, on the inside", () => {
    const chosen = rowClass(true).split(" ");
    for (const c of [
      "border-accent",
      "inset-ring",
      "inset-ring-accent",
      "bg-surface",
    ]) {
      assert.ok(chosen.includes(c), c);
    }
    assert.ok(!chosen.includes("border-transparent"));
  });

  test("keeps the other rows without a visible border", () => {
    const idle = rowClass(false).split(" ");
    assert.ok(idle.includes("border-transparent"));
    assert.ok(!idle.includes("border-accent"));
  });
});
