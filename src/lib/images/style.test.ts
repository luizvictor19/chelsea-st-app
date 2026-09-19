import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MEDIUM_PROMPT,
  STYLE_PROMPT,
  SUBJECT_RULES,
  buildPrompt,
} from "./style.ts";

const SUBJECT = "a man sitting on a chair";

describe("buildPrompt", () => {
  /*
   * 2026-09-19, twice over. The character used to be the last sentence, after
   * eleven style constraints, and a generation of "sitting" came back as an
   * empty chair, so who is in the picture moved up next to the subject. That
   * pushed the medium to the seventh sentence, and an image model weighs its
   * opening, so the medium came back to the front and brought the subject
   * with it. What stayed in the tail is the part that can wait.
   */
  test("says the medium and subject, then the rule, then the rest of the style", () => {
    const prompt = buildPrompt(SUBJECT, "pose");
    const ruleAt = prompt.indexOf(SUBJECT_RULES.pose);
    const styleAt = prompt.indexOf(STYLE_PROMPT);
    assert.ok(
      prompt.startsWith(
        "Flat vector illustration of a man sitting on a chair.",
      ),
      "the medium and the subject open together",
    );
    assert.ok(prompt.indexOf("chair") < ruleAt, "the rule follows the subject");
    assert.ok(ruleAt < styleAt, "the rest of the style comes last");
    assert.ok(prompt.endsWith(STYLE_PROMPT));
  });

  test("names the medium once, and in the first words", () => {
    for (const kind of ["photo", "pose", "action", "figure"]) {
      const prompt = buildPrompt("a red apple", kind);
      assert.ok(prompt.startsWith("Flat vector illustration of a red apple."));
      const occurrences =
        prompt.toLowerCase().split("flat vector illustration").length - 1;
      assert.equal(occurrences, 1, `${kind} repeats the medium`);
    }
    assert.doesNotMatch(STYLE_PROMPT, /flat vector illustration/iu);
    assert.match(MEDIUM_PROMPT, /flat vector illustration/iu);
  });

  test("the style is the same for every kind", () => {
    for (const kind of ["photo", "pose", "action", "figure"]) {
      assert.ok(buildPrompt(SUBJECT, kind).includes(STYLE_PROMPT), kind);
    }
  });

  /*
   * The teacher types this field, so it arrives with whatever spacing and
   * punctuation typing leaves behind. A trailing stop would land next to the
   * one the opening sentence already ends with.
   */
  test("trims the subject and drops a trailing stop", () => {
    const plain = buildPrompt("a cat", "photo");
    assert.equal(buildPrompt("  a cat  ", "photo"), plain);
    assert.equal(buildPrompt("a cat.", "photo"), plain);
    assert.equal(buildPrompt("a cat . ", "photo"), plain);
  });

  test("refuses an empty subject instead of paying for nothing", () => {
    assert.throws(() => buildPrompt("", "photo"), /subject/);
    assert.throws(() => buildPrompt("   ", "photo"), /subject/);
    assert.throws(() => buildPrompt(".", "photo"), /subject/);
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
});

describe("how many things are in the frame", () => {
  /*
   * 2026-09-19: "Single subject" used to be in the style, applying to every
   * category. Asked for a man sitting on a chair under it, the model drew the
   * chair and left the man out. Each category answers the question now.
   */
  test("the style no longer decides it for everyone", () => {
    assert.doesNotMatch(STYLE_PROMPT, /single subject/iu);
  });

  test("photo is the only one that asks for a single subject", () => {
    assert.match(SUBJECT_RULES.photo, /single subject/iu);
    for (const kind of ["pose", "action", "figure"] as const) {
      assert.doesNotMatch(SUBJECT_RULES[kind], /single subject/iu);
    }
  });

  test("pose and action ask for the person and the object they use", () => {
    for (const kind of ["pose", "action"] as const) {
      assert.match(SUBJECT_RULES[kind], /whole person/iu);
      assert.match(SUBJECT_RULES[kind], /object they are using/iu);
    }
  });

  test("figure asks for the objects named and an empty background", () => {
    assert.match(SUBJECT_RULES.figure, /no person in it/iu);
    assert.match(SUBJECT_RULES.figure, /only the objects the subject names/iu);
    assert.match(SUBJECT_RULES.figure, /nothing else in the background/iu);
  });
});

describe("the rule each kind adds", () => {
  test("photo asks for the subject alone", () => {
    const prompt = buildPrompt(SUBJECT, "photo");
    assert.match(prompt, /on its own/iu);
    assert.doesNotMatch(prompt, /arrow/iu);
  });

  /*
   * The pair the sixth kind exists for. Pose forbids the arrow and action
   * offers it when there is a direction, and that is the difference between
   * a picture that reads as sitting and one that reads as sit down.
   */
  test("pose asks for a still body and forbids the arrow", () => {
    const prompt = buildPrompt(SUBJECT, "pose");
    assert.match(prompt, /posture clearly readable/iu);
    assert.match(prompt, /no movement/iu);
    assert.match(prompt, /No arrow/u);
  });

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
    assert.match(buildPrompt(SUBJECT, "pose"), /man sitting on a chair/u);
  });

  test("action always asks for the middle of the movement", () => {
    assert.match(
      buildPrompt("a man standing up", "action"),
      /middle of the movement/iu,
    );
  });

  test("action offers the arrow as a condition, never as an order", () => {
    assert.match(SUBJECT_RULES.action, /if the movement has a direction/iu);
    assert.match(SUBJECT_RULES.action, /if it does not, no arrow/iu);
  });

  test("pose mentions the arrow only to refuse it", () => {
    assert.doesNotMatch(SUBJECT_RULES.pose, /(?<!No )arrow/u);
  });

  /*
   * 2026-09-19: the first two real images each invented their own person, and
   * one changed its own shirt colour between the top and the bottom of the
   * figure. The character is fixed only where a person is drawn.
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

  test("symbol and none have no prompt to build", () => {
    assert.throws(() => buildPrompt(SUBJECT, "symbol"), /symbol/);
    assert.throws(() => buildPrompt(SUBJECT, "none"), /none/);
  });

  test("every drawable kind carries its own rule and no other", () => {
    for (const [kind, rule] of Object.entries(SUBJECT_RULES)) {
      const prompt = buildPrompt(SUBJECT, kind);
      assert.ok(prompt.includes(rule), kind);
      for (const [other, otherRule] of Object.entries(SUBJECT_RULES)) {
        if (other !== kind) assert.ok(!prompt.includes(otherRule), other);
      }
    }
  });
});
