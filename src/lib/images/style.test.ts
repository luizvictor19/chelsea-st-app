import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { STYLE_PROMPT, SUBJECT_RULES, buildPrompt } from "./style.ts";

describe("buildPrompt", () => {
  test("puts the subject where the slot is and keeps the style intact", () => {
    const prompt = buildPrompt("a red apple", "photo");
    assert.ok(prompt.startsWith("Flat vector illustration of a red apple."));
    assert.ok(prompt.includes("no watermark"));
    assert.ok(!prompt.includes("{subject}"));
  });

  test("the style is fixed, so only the subject and the rule differ", () => {
    const a = buildPrompt("a cat", "photo");
    const b = buildPrompt("a dog", "photo");
    const tail = STYLE_PROMPT.slice(STYLE_PROMPT.indexOf("Single subject"));
    assert.ok(a.includes(tail));
    assert.ok(b.includes(tail));
  });

  /*
   * The teacher types this field, so it arrives with whatever spacing and
   * punctuation typing leaves behind. A trailing stop would land next to the
   * one the sentence already has.
   */
  test("trims the subject and drops a trailing stop", () => {
    assert.equal(
      buildPrompt("  a cat  ", "photo"),
      buildPrompt("a cat", "photo"),
    );
    assert.equal(buildPrompt("a cat.", "photo"), buildPrompt("a cat", "photo"));
    assert.equal(
      buildPrompt("a cat . ", "photo"),
      buildPrompt("a cat", "photo"),
    );
  });

  test("refuses an empty subject instead of paying for nothing", () => {
    assert.throws(() => buildPrompt("", "photo"), /subject/);
    assert.throws(() => buildPrompt("   ", "photo"), /subject/);
    assert.throws(() => buildPrompt(".", "photo"), /subject/);
  });
});

describe("the rule each kind adds", () => {
  const SUBJECT = "a man sitting on a chair";

  test("photo asks for the subject alone", () => {
    const prompt = buildPrompt(SUBJECT, "photo");
    assert.ok(prompt.endsWith(SUBJECT_RULES.photo));
    assert.match(prompt, /on its own/iu);
    assert.doesNotMatch(prompt, /arrow/iu);
  });

  /*
   * The pair the sixth kind exists for. Pose says no arrow and action asks
   * for one, and that single word is the whole difference between a picture
   * that reads as sitting and one that reads as sit down.
   */
  test("pose asks for a still whole body and forbids the arrow", () => {
    const prompt = buildPrompt(SUBJECT, "pose");
    assert.ok(prompt.endsWith(SUBJECT_RULES.pose));
    assert.match(prompt, /standing still/iu);
    assert.match(prompt, /whole body/iu);
    assert.match(prompt, /No arrow/u);
  });

  test("action asks for the movement and the arrow", () => {
    const prompt = buildPrompt("a man standing up", "action");
    assert.ok(prompt.endsWith(SUBJECT_RULES.action));
    assert.match(prompt, /middle of the movement/iu);
    assert.match(prompt, /a single arrow/iu);
  });

  test("figure asks for a diagram with nobody in it", () => {
    const prompt = buildPrompt("a ball under a box", "figure");
    assert.ok(prompt.endsWith(SUBJECT_RULES.figure));
    assert.match(prompt, /diagram/iu);
    assert.match(prompt, /no person/iu);
  });

  /*
   * A symbol is the character, drawn by the screen, and none has no picture
   * at all. Building a prompt for either would be paying for an image nobody
   * is going to look at.
   */
  test("symbol and none have no prompt to build", () => {
    assert.throws(() => buildPrompt(SUBJECT, "symbol"), /symbol/);
    assert.throws(() => buildPrompt(SUBJECT, "none"), /none/);
  });

  test("every drawable kind ends with its own rule and no other", () => {
    for (const [kind, rule] of Object.entries(SUBJECT_RULES)) {
      const prompt = buildPrompt(SUBJECT, kind);
      assert.ok(prompt.endsWith(rule), kind);
      for (const [other, otherRule] of Object.entries(SUBJECT_RULES)) {
        if (other !== kind) assert.ok(!prompt.includes(otherRule), other);
      }
    }
  });
});
