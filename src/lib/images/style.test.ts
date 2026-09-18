import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { STYLE_PROMPT, buildPrompt } from "./style.ts";

describe("buildPrompt", () => {
  test("puts the subject where the slot is and keeps the rest intact", () => {
    const prompt = buildPrompt("a red apple");
    assert.ok(prompt.startsWith("Flat vector illustration of a red apple."));
    assert.ok(prompt.includes("no watermark"));
    assert.ok(!prompt.includes("{subject}"));
  });

  test("the style is fixed, so only the subject differs between two prompts", () => {
    const a = buildPrompt("a cat");
    const b = buildPrompt("a dog");
    const tail = STYLE_PROMPT.slice(STYLE_PROMPT.indexOf("Single subject"));
    assert.ok(a.endsWith(tail));
    assert.ok(b.endsWith(tail));
  });

  /*
   * The teacher types this field, so it arrives with whatever spacing and
   * punctuation typing leaves behind. A trailing stop would land next to the
   * one the sentence already has.
   */
  test("trims the subject and drops a trailing stop", () => {
    assert.equal(buildPrompt("  a cat  "), buildPrompt("a cat"));
    assert.equal(buildPrompt("a cat."), buildPrompt("a cat"));
    assert.equal(buildPrompt("a cat . "), buildPrompt("a cat"));
  });

  test("refuses an empty subject instead of paying for nothing", () => {
    assert.throws(() => buildPrompt(""), /subject/);
    assert.throws(() => buildPrompt("   "), /subject/);
    assert.throws(() => buildPrompt("."), /subject/);
  });
});
