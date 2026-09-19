import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { approvedFirst } from "./attempt-order.ts";

const at = (id: string, status: string, createdAt: string) => ({
  id,
  status,
  createdAt,
});

describe("approvedFirst", () => {
  /*
   * The case the function exists for: the approved image was made early and
   * four attempts followed it. By date alone it sits at the bottom, which is
   * where the one picture in use is least findable.
   */
  test("lifts the approved attempt above newer ones", () => {
    const ordered = approvedFirst([
      at("d", "generated", "2026-09-19T04:00:00Z"),
      at("c", "rejected", "2026-09-19T03:00:00Z"),
      at("a", "approved", "2026-09-19T01:00:00Z"),
      at("b", "failed", "2026-09-19T02:00:00Z"),
    ]);
    assert.deepEqual(
      ordered.map((attempt) => attempt.id),
      ["a", "d", "c", "b"],
    );
  });

  test("with no approved attempt it is newest first", () => {
    const ordered = approvedFirst([
      at("b", "generated", "2026-09-19T02:00:00Z"),
      at("c", "generated", "2026-09-19T03:00:00Z"),
      at("a", "generated", "2026-09-19T01:00:00Z"),
    ]);
    assert.deepEqual(
      ordered.map((attempt) => attempt.id),
      ["c", "b", "a"],
    );
  });

  test("does not touch what it was given", () => {
    const input = [
      at("b", "generated", "2026-09-19T02:00:00Z"),
      at("a", "approved", "2026-09-19T01:00:00Z"),
    ];
    const copy = [...input];
    approvedFirst(input);
    assert.deepEqual(input, copy);
  });

  test("an empty list stays empty", () => {
    assert.deepEqual(approvedFirst([]), []);
  });
});
