import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { everyRow } from "./every-row.ts";

/** A table of `total` rows behind an API that answers at most `cap` a call. */
function table(total: number, cap: number) {
  const calls: number[] = [];
  const rows = Array.from({ length: total }, (_, index) => index);
  return {
    calls,
    read: async (from: number) => {
      calls.push(from);
      return { rows: rows.slice(from, from + cap), total };
    },
  };
}

describe("everyRow", () => {
  test("one call when the first answer is the whole table", async () => {
    const source = table(283, 1000);
    assert.equal((await everyRow(source.read)).length, 283);
    assert.deepEqual(source.calls, [0]);
  });

  test("keeps asking, from where it stopped, when the answer is capped", async () => {
    const source = table(2300, 1000);
    const rows = await everyRow(source.read);
    assert.deepEqual(source.calls, [0, 1000, 2000]);
    assert.deepEqual(
      rows,
      Array.from({ length: 2300 }, (_, index) => index),
    );
  });

  test("an empty table is no rows and one call", async () => {
    const source = table(0, 1000);
    assert.deepEqual(await everyRow(source.read), []);
    assert.deepEqual(source.calls, [0]);
  });

  test("stops when the table shrinks under it instead of asking forever", async () => {
    let call = 0;
    const rows = await everyRow(async () => {
      call += 1;
      return call === 1 ? { rows: [1, 2], total: 5 } : { rows: [], total: 5 };
    });
    assert.deepEqual(rows, [1, 2]);
    assert.equal(call, 2);
  });
});
