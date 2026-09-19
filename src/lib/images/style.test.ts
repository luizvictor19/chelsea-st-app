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

  /*
   * 2026-09-19: the first real figure came back inside a black frame. The
   * style asked for a plain background and never said the background was the
   * whole image, so a border broke no rule that had been written down.
   */
  test("forbids a frame, in every prompt", () => {
    for (const kind of ["photo", "pose", "action", "figure"]) {
      const prompt = buildPrompt("a thing", kind);
      assert.match(prompt, /no frame, no border/iu);
      assert.match(prompt, /background fills the entire image/iu);
    }
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
    assert.match(prompt, /whole body/iu);
    assert.match(prompt, /posture clearly readable/iu);
    assert.match(prompt, /no movement/iu);
    assert.match(prompt, /No arrow/u);
  });

  /*
   * The rule may not name a posture. It said "standing still", meaning
   * motionless, but standing is itself a posture and a word in this
   * vocabulary, so the instruction argued with every subject that was
   * sitting or lying. The rule describes how to draw a posture; the subject
   * is what says which one.
   */
  test("the pose rule names no posture of its own", () => {
    for (const posture of ["standing", "sitting", "lying", "kneeling"]) {
      assert.doesNotMatch(
        SUBJECT_RULES.pose,
        new RegExp(posture, "iu"),
        `the pose rule must not say ${posture}`,
      );
    }
  });

  test("the subject still carries the posture through untouched", () => {
    const prompt = buildPrompt("a man sitting on a chair", "pose");
    assert.match(prompt, /a man sitting on a chair/u);
  });

  /*
   * The movement is the category; the arrow is only a way of drawing a
   * direction when there is one. Asked for unconditionally it turned up on
   * smile and listen, pointing at nothing, which is why the two halves are
   * asserted differently: one is always required, the other must be offered
   * as a condition and must state the case where it is left out.
   */
  test("action always asks for the middle of the movement", () => {
    const prompt = buildPrompt("a man standing up", "action");
    assert.ok(prompt.endsWith(SUBJECT_RULES.action));
    assert.match(prompt, /middle of the movement/iu);
    assert.match(prompt, /whole body/iu);
  });

  test("action offers the arrow as a condition, never as an order", () => {
    assert.match(SUBJECT_RULES.action, /if the movement has a direction/iu);
    // The branch that was missing: a movement with no direction gets none.
    assert.match(SUBJECT_RULES.action, /if it does not, no arrow/iu);
  });

  test("pose mentions the arrow only to refuse it", () => {
    assert.doesNotMatch(SUBJECT_RULES.pose, /(?<!No )arrow/u);
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

  /*
   * 2026-09-19: the first two real images each invented their own person, and
   * one changed its own shirt colour between the top and the bottom of the
   * figure. The character is fixed only where a person is drawn: a photo of a
   * pen and a diagram have nobody in them.
   */
  test("fixes the character in pose and action, and only there", () => {
    for (const kind of ["pose", "action"]) {
      const prompt = buildPrompt("a thing", kind);
      assert.match(prompt, /always the same character/iu);
      assert.match(prompt, /short dark hair/iu);
      assert.match(prompt, /consistent across the whole figure/iu);
    }
    for (const kind of ["photo", "figure"]) {
      assert.doesNotMatch(
        buildPrompt("a thing", kind),
        /always the same character/iu,
      );
    }
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
