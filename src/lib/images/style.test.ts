import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type ImageStyle,
  STYLES,
  SUBJECT_RULES,
  buildPrompt,
} from "./style.ts";

const SUBJECT = "a man sitting on a chair";

const KINDS = ["photo", "pose", "action", "figure"] as const;
const STYLE_NAMES = Object.keys(STYLES) as ImageStyle[];

/**
 * The words that name each medium, for counting how often it is said.
 *
 * Written out rather than derived from the constant: what these assert is
 * that the medium is announced once and in the opening, and a token computed
 * from the same string it is checked against would assert nothing.
 *
 * "photograph of" and not "photograph", because the realistic tail ends in
 * "the photograph fills the entire image" and that is not a second
 * announcement of the medium.
 */
const MEDIUM_WORDS: Record<ImageStyle, string> = {
  flat: "flat vector illustration",
  realistic: "photograph of",
};

describe("buildPrompt", () => {
  /*
   * 2026-09-19, twice over. The description of who was in the picture used to
   * be the last sentence, after eleven style constraints, and a generation of
   * "sitting" came back as an empty chair, so it moved up next to the
   * subject. That pushed the medium to the seventh sentence, and an image
   * model weighs its opening, so the medium came back to the front and
   * brought the subject with it. What stayed in the tail is the part that can
   * wait.
   *
   * True of both styles, and that is the point of the loop: the ordering was
   * bought with flat generations, and a second style inherits it rather than
   * getting to rediscover it.
   */
  test("says the medium and subject, then the rule, then the rest", () => {
    for (const style of STYLE_NAMES) {
      const prompt = buildPrompt(SUBJECT, "pose", style);
      const ruleAt = prompt.indexOf(SUBJECT_RULES.pose);
      const restAt = prompt.indexOf(STYLES[style].rest);
      assert.ok(
        prompt.startsWith(STYLES[style].medium.replace("{subject}", SUBJECT)),
        `${style}: the medium and the subject open together`,
      );
      assert.ok(
        prompt.indexOf("chair") < ruleAt,
        `${style}: rule after subject`,
      );
      assert.ok(ruleAt < restAt, `${style}: the rest of the style comes last`);
      assert.ok(prompt.endsWith(STYLES[style].rest), style);
    }
  });

  test("names its medium once, in the first words, and no other medium", () => {
    for (const style of STYLE_NAMES) {
      for (const kind of KINDS) {
        const prompt = buildPrompt("a red apple", kind, style).toLowerCase();
        const mine = MEDIUM_WORDS[style];
        assert.ok(prompt.startsWith(mine), `${style}/${kind} opens elsewhere`);
        assert.equal(
          prompt.split(mine).length - 1,
          1,
          `${style}/${kind} repeats the medium`,
        );
        for (const other of STYLE_NAMES) {
          if (other === style) continue;
          assert.ok(
            !prompt.includes(MEDIUM_WORDS[other]),
            `${style}/${kind} also says it is ${other}`,
          );
        }
      }
      // The tail is the rest of the style, not a second announcement of it.
      assert.ok(
        !STYLES[style].rest.toLowerCase().includes(MEDIUM_WORDS[style]),
      );
    }
  });

  test("the style is the same for every kind", () => {
    for (const style of STYLE_NAMES) {
      for (const kind of KINDS) {
        assert.ok(
          buildPrompt(SUBJECT, kind, style).includes(STYLES[style].rest),
          `${style}/${kind}`,
        );
      }
    }
  });

  test("every style forbids a frame and fills the image", () => {
    for (const style of STYLE_NAMES) {
      for (const kind of KINDS) {
        const prompt = buildPrompt("a thing", kind, style);
        assert.match(prompt, /no frame, no border/iu, `${style}/${kind}`);
        assert.match(prompt, /fills the entire image/iu, `${style}/${kind}`);
      }
    }
  });

  test("every style forbids text in the picture", () => {
    for (const style of STYLE_NAMES) {
      const prompt = buildPrompt("a thing", "photo", style);
      assert.match(
        prompt,
        /no text, no letters, no numbers, no watermark/iu,
        style,
      );
    }
  });

  /*
   * The teacher types this field, so it arrives with whatever spacing and
   * punctuation typing leaves behind. A trailing stop would land next to the
   * one the opening sentence already ends with.
   */
  test("trims the subject and drops a trailing stop", () => {
    for (const style of STYLE_NAMES) {
      const plain = buildPrompt("a cat", "photo", style);
      assert.equal(buildPrompt("  a cat  ", "photo", style), plain);
      assert.equal(buildPrompt("a cat.", "photo", style), plain);
      assert.equal(buildPrompt("a cat . ", "photo", style), plain);
    }
  });

  test("refuses an empty subject instead of paying for nothing", () => {
    for (const style of STYLE_NAMES) {
      assert.throws(() => buildPrompt("", "photo", style), /subject/);
      assert.throws(() => buildPrompt("   ", "photo", style), /subject/);
      assert.throws(() => buildPrompt(".", "photo", style), /subject/);
    }
  });

  test("symbol and none have no prompt to build, in any style", () => {
    for (const style of STYLE_NAMES) {
      assert.throws(() => buildPrompt(SUBJECT, "symbol", style), /symbol/);
      assert.throws(() => buildPrompt(SUBJECT, "none", style), /none/);
    }
  });
});

/*
 * The flat style is the one that was paid for, generation by generation, on
 * 2026-09-19. These assert the decisions of that day and they name flat on
 * purpose: a second style must not be able to drag the first one's wording
 * along with it, and a rewrite of flat must not be able to put back what was
 * measured out of it.
 */
describe("the flat style, as it was bought", () => {
  test("opens on flat vector illustration", () => {
    assert.equal(STYLES.flat.medium, "Flat vector illustration of {subject}.");
  });

  /*
   * 2026-09-19: the style asked for bold outlines and no shading, a real
   * generation of "sitting" ignored both, and what came back was better. The
   * words describe that picture now.
   *
   * This asserts the decision rather than the prose, so the next rewrite
   * cannot quietly put the outlines back. While the constant describes a
   * drawing nobody wants, the result is a toss-up between two styles, which
   * is what had already happened between "book" and "sitting".
   */
  test("asks for no outlines", () => {
    for (const kind of KINDS) {
      const prompt = buildPrompt("a thing", kind, "flat");
      assert.match(prompt, /no outlines/iu);
      assert.doesNotMatch(prompt, /bold outlines/iu);
    }
    assert.match(STYLES.flat.rest, /no outlines/iu);
  });

  test("describes the drawing that came back, not the one that was asked for", () => {
    assert.match(STYLES.flat.rest, /solid flat colors/iu);
    assert.match(STYLES.flat.rest, /limited muted palette/iu);
    assert.match(STYLES.flat.rest, /soft shadow under the subject/iu);
    // The old constant forbade shading outright, which is what produced a
    // flat cut-out with nothing holding it to the ground.
    assert.doesNotMatch(STYLES.flat.rest, /no shading/iu);
  });

  /*
   * 2026-09-19: the first real figure came back inside a black frame. The
   * style asked for a plain background and never said the background was the
   * whole image, so a border broke no rule that had been written down.
   */
  test("says the background is the whole image", () => {
    assert.match(STYLES.flat.rest, /background fills the entire image/iu);
  });
});

/*
 * The realistic style, 2026-09-20. Nothing here is a measurement: no picture
 * has been generated in it yet. What these hold is the shape a style has to
 * have to be one, and the one wording decision that was made on purpose.
 */
describe("the realistic style, as proposed", () => {
  test("opens on a photograph", () => {
    assert.equal(STYLES.realistic.medium, "Photograph of {subject}.");
  });

  test("asks for light, materials and focus", () => {
    assert.match(STYLES.realistic.rest, /natural light/iu);
    assert.match(STYLES.realistic.rest, /realistic materials and depth/iu);
    assert.match(STYLES.realistic.rest, /plain uncluttered setting/iu);
    assert.match(STYLES.realistic.rest, /sharp focus/iu);
  });

  /*
   * "the photograph fills the entire image", not "the image fills the entire
   * frame". The sentence forbids a frame two clauses earlier, and one word
   * cannot be the thing forbidden and the picture itself in the same breath.
   */
  test("does not use frame for both the border and the picture", () => {
    assert.match(
      STYLES.realistic.rest,
      /the photograph fills the entire image/iu,
    );
    assert.doesNotMatch(STYLES.realistic.rest, /fills the entire frame/iu);
  });

  /*
   * A flat illustration of a room is the reason this style exists, so the
   * pairing that must work is a photo word in the realistic style.
   */
  test("a place reads as a photograph of itself", () => {
    const prompt = buildPrompt(
      "an empty room seen from the doorway",
      "photo",
      "realistic",
    );
    assert.ok(
      prompt.startsWith("Photograph of an empty room seen from the doorway."),
    );
    assert.match(prompt, /on its own/iu);
    assert.doesNotMatch(prompt, /vector/iu);
  });
});

describe("how many things are in the frame", () => {
  /*
   * 2026-09-19: "Single subject" used to be in the style, applying to every
   * category. Asked for a man sitting on a chair under it, the model drew the
   * chair and left the man out. Each category answers the question now.
   */
  test("no style decides it for everyone", () => {
    for (const style of STYLE_NAMES) {
      assert.doesNotMatch(STYLES[style].rest, /single subject/iu, style);
    }
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
  /*
   * 2026-09-20, and the reason the rules could stay shared between two
   * styles. They used to say draw: "Draw it as a diagram" and "draw the view
   * the subject names", written when there was one medium and it was a
   * drawing. Under "Photograph of a room." that contradicts the first
   * sentence of the prompt.
   *
   * The medium is named once, by the style, and these say what is in the
   * picture rather than how it is made. This is the guard on that: a rule
   * added with a verb of its own turns red here instead of arguing with the
   * opening of every realistic prompt.
   */
  test("no rule names a technique", () => {
    for (const [kind, rule] of Object.entries(SUBJECT_RULES)) {
      assert.doesNotMatch(
        rule,
        /\b(draw|draws|drawn|drawing|paint|painted|render|rendered|shoot|shot|photograph|photographed|illustrate|illustration)\b/iu,
        `the ${kind} rule names a technique, which belongs to the style`,
      );
    }
  });

  test("photo asks for the subject alone", () => {
    const prompt = buildPrompt(SUBJECT, "photo", "flat");
    assert.match(prompt, /on its own/iu);
    assert.doesNotMatch(prompt, /arrow/iu);
  });

  /*
   * The pair the sixth kind exists for. Pose forbids the arrow and action
   * offers it when there is a direction, and that is the difference between
   * a picture that reads as sitting and one that reads as sit down.
   */
  test("pose asks for a still body and forbids the arrow", () => {
    const prompt = buildPrompt(SUBJECT, "pose", "flat");
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
    assert.match(
      buildPrompt(SUBJECT, "pose", "flat"),
      /man sitting on a chair/u,
    );
  });

  test("action always asks for the middle of the movement", () => {
    assert.match(
      buildPrompt("a man standing up", "action", "flat"),
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
   * The rules used to describe one fixed man for pose and action. Tried on
   * 2026-09-19 and abandoned the same day: three real generations came back
   * with a chair and nobody in it, and two people matching neither the
   * description nor each other. A text to image model keeps no identity
   * between calls, and Seedream 4 takes no reference image to keep one with.
   *
   * This asserts the absence, so that nobody reintroduces two sentences per
   * prompt that were measured not to work.
   */
  test("describes no fixed character, in any kind or style", () => {
    for (const style of STYLE_NAMES) {
      for (const kind of KINDS) {
        const prompt = buildPrompt("a thing", kind, style);
        assert.doesNotMatch(prompt, /always the same character/iu);
        assert.doesNotMatch(prompt, /short dark hair/iu);
        assert.doesNotMatch(prompt, /consistent across the whole figure/iu);
      }
    }
  });

  /*
   * 2026-09-19: "sitting" took four attempts and the angle is what fixed it.
   * A seated person drawn from the front does not read as seated; the bent
   * knee in profile is what says it. Only where a body is in the picture: a
   * pen and a diagram have no posture to lose.
   */
  test("asks pose and action for the angle, and only them", () => {
    for (const kind of ["pose", "action"]) {
      const prompt = buildPrompt("a thing", kind, "flat");
      assert.match(prompt, /viewing angle is part of the meaning/iu);
      assert.match(prompt, /show the view the subject names/iu);
    }
    for (const kind of ["photo", "figure"]) {
      assert.doesNotMatch(
        buildPrompt("a thing", kind, "flat"),
        /viewing angle/iu,
      );
    }
  });

  test("every drawable kind carries its own rule and no other", () => {
    for (const [kind, rule] of Object.entries(SUBJECT_RULES)) {
      const prompt = buildPrompt(SUBJECT, kind, "flat");
      assert.ok(prompt.includes(rule), kind);
      for (const [other, otherRule] of Object.entries(SUBJECT_RULES)) {
        if (other !== kind) assert.ok(!prompt.includes(otherRule), other);
      }
    }
  });
});
