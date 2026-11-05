import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TEXT_PRICES, usdFor } from "../text/cost.ts";
import {
  SCENE_MAX_WORDS,
  SCENE_RULES,
  SCENE_SUBJECT_MODEL,
  buildSceneSubjectPrompt,
} from "./scene-subject.ts";
import { sceneRules } from "./subject.ts";

/*
 * The input of the measurement whose first Haiku pass drew another small
 * thing instead of a small picture (#187, batch "first", 2026-11-04).
 */
const PICTURE = {
  sentence: "No, the picture isn’t large; it’s small",
  question: "Is the picture large?",
  style: "flat",
} as const;

const BOX = {
  sentence: "No, the box isn’t small; it’s large",
  question: "Is the box small?",
  style: "flat",
} as const;

describe("buildSceneSubjectPrompt", () => {
  test("carries the line and the question it answers", () => {
    const { user } = buildSceneSubjectPrompt(BOX);
    assert.match(user, /No, the box isn’t small; it’s large/u);
    assert.match(user, /Is the box small\?/u);
  });

  test("says nothing about a question when the line has none", () => {
    for (const question of [null, "", "  "]) {
      const { user } = buildSceneSubjectPrompt({
        sentence: "the pen on the book",
        question,
        style: "flat",
      });
      assert.match(user, /the pen on the book/u);
      assert.doesNotMatch(user, /question/iu);
    }
  });

  test("carries the three rules a scene shares with a word, in the style asked for", () => {
    for (const style of ["flat", "realistic"] as const) {
      const { system } = buildSceneSubjectPrompt({ ...BOX, style });
      for (const rule of sceneRules(style)) {
        assert.ok(system.includes(rule), `missing for ${style}: ${rule}`);
      }
    }
    // And the other style's recognition rule is not there.
    const flat = buildSceneSubjectPrompt({ ...BOX, style: "flat" }).system;
    assert.ok(!flat.includes(sceneRules("realistic")[1]));
  });

  test("carries the four rules of a scene, numbered after the shared ones", () => {
    const { system } = buildSceneSubjectPrompt(BOX);
    assert.equal(SCENE_RULES.length, 4);
    SCENE_RULES.forEach((rule, index) => {
      assert.ok(system.includes(`${index + 4}. ${rule}`), rule);
    });
  });

  test("keeps a picture the line names an object in the scene", () => {
    const { system, user } = buildSceneSubjectPrompt(PICTURE);
    assert.match(user, /Is the picture large\?/u);
    assert.match(user, /No, the picture isn’t large; it’s small/u);
    assert.ok(system.includes(`7. ${SCENE_RULES[3]}`));
    // The example is not one of the measured inputs: it would hand the
    // model the answer it is scored on.
    assert.doesNotMatch(SCENE_RULES[3], /the picture/u);
    assert.match(system, /7 rules, learned/u);
  });

  test("does not carry the one-subject rule of a word: a scene relates two things", () => {
    const { system } = buildSceneSubjectPrompt(BOX);
    assert.doesNotMatch(system, /One subject, showing only/u);
  });

  test("asks for json and states the word limit", () => {
    const { system } = buildSceneSubjectPrompt(BOX);
    assert.match(system, /json/u);
    assert.match(system, new RegExp(`at most ${SCENE_MAX_WORDS} words`, "u"));
    assert.equal(SCENE_MAX_WORDS, 20);
  });

  test("refuses an empty line", () => {
    for (const sentence of ["", "   "]) {
      assert.throws(
        () => buildSceneSubjectPrompt({ ...BOX, sentence }),
        /needs the line/u,
      );
    }
  });
});

describe("SCENE_SUBJECT_MODEL", () => {
  test("has a price, so what a proposal costs can be worked out", () => {
    assert.ok(Object.hasOwn(TEXT_PRICES, SCENE_SUBJECT_MODEL));
    const usage = { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 };
    assert.ok(usdFor(SCENE_SUBJECT_MODEL, usage) > 0);
  });
});
