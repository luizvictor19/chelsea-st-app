import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readCostForm } from "./cost-form.ts";

function form(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    brand: "chelsea-st",
    action: "teacher_lesson",
    credits: "4",
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("readCostForm", () => {
  test("a full form gives the row", () => {
    assert.deepEqual(readCostForm(form({ credits: " 12 " })), {
      ok: true,
      values: { brand: "chelsea-st", action: "teacher_lesson", credits: 12 },
    });
  });

  test("each rule of credit_costs is said before the database", () => {
    const cases: [Record<string, string>, RegExp][] = [
      [{ brand: "other" }, /marca/],
      [{ action: "chat_question" }, /o que o custo paga/],
      [{ credits: "0" }, /maior que zero/],
      [{ credits: "" }, /maior que zero/],
      [{ credits: "1.5" }, /maior que zero/],
      [{ credits: "-2" }, /maior que zero/],
      [{ credits: "2147483648" }, /maior que zero/],
    ];
    for (const [over, message] of cases) {
      const read = readCostForm(form(over));
      assert.equal(read.ok, false, JSON.stringify(over));
      if (!read.ok) assert.match(read.message, message);
    }
  });

  test("the largest integer the column holds passes", () => {
    assert.equal(readCostForm(form({ credits: "2147483647" })).ok, true);
  });
});
