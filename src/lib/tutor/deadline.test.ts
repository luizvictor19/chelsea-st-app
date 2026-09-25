import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { withDeadline } from "./deadline.ts";

const never = new Promise<void>(() => {});
const after = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("withDeadline", () => {
  test("is done when the work ends first", async () => {
    assert.equal(await withDeadline(after(5), 200), "done");
  });

  /*
   * The case it exists for: a voice that never says it has finished. Without
   * the deadline this await would hang the test, which is the screen stuck in
   * "speaking" in miniature.
   */
  test("times out when the work never ends", async () => {
    assert.equal(await withDeadline(never, 20), "timed-out");
  });

  test("counts a failed voice as done, not as a hang", async () => {
    assert.equal(
      await withDeadline(Promise.reject(new Error("synthesis-failed")), 200),
      "done",
    );
  });
});
