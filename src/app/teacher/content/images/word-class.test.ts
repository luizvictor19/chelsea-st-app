import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Constants } from "../../../../lib/supabase/types.ts";
import { WORD_CLASS_LABELS, wordClassLabel } from "./word-class.ts";

const ENUM = Constants.public.Enums.word_class;

describe("WORD_CLASS_LABELS", () => {
  test("labels every class the database has, and nothing else", () => {
    const listed = WORD_CLASS_LABELS.map((item) => item.value);
    for (const value of ENUM) {
      assert.ok(listed.includes(value), `no label for ${value}`);
    }
    for (const value of listed) {
      assert.ok((ENUM as readonly string[]).includes(value), `stale: ${value}`);
    }
    assert.equal(listed.length, ENUM.length);
  });

  test("every label is filled in and distinct", () => {
    const labels = WORD_CLASS_LABELS.map((item) => item.label);
    assert.ok(labels.every((label) => label.trim() !== ""));
    assert.equal(new Set(labels).size, labels.length);
  });

  test("names a class it knows and says so when there is none", () => {
    assert.equal(wordClassLabel("question_word"), "Palavra interrogativa");
    assert.equal(wordClassLabel(null), "sem classe");
  });
});
