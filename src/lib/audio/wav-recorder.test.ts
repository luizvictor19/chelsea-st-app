import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { joinBlocks, wavRecordingUnavailableReason } from "./wav-recorder.ts";

describe("joinBlocks", () => {
  const blocks = [new Float32Array([1, 2]), new Float32Array([3, 4, 5])];

  test("joins the blocks in order", () => {
    assert.deepEqual([...joinBlocks(blocks, 100)], [1, 2, 3, 4, 5]);
  });

  test("stops at the cap, inside a block", () => {
    assert.deepEqual([...joinBlocks(blocks, 3)], [1, 2, 3]);
  });

  test("nothing recorded is an empty take", () => {
    assert.equal(joinBlocks([], 10).length, 0);
  });
});

test("without a browser there is no microphone to record from", () => {
  assert.match(wavRecordingUnavailableReason() ?? "", /microfone/);
});
