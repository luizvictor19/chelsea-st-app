import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildSubjectPrompt, learnedRules, parseSubject } from "./subject.ts";

const STYLES = ["flat", "realistic"] as const;
const KINDS = ["photo", "pose", "action", "figure"] as const;

describe("buildSubjectPrompt", () => {
  test("names the word it is asking about", () => {
    const { user } = buildSubjectPrompt("umbrella", "photo", "flat");
    assert.match(user, /umbrella/u);
  });

  test("names the kind, so the shape of the answer follows the category", () => {
    assert.match(buildSubjectPrompt("sitting", "pose", "flat").user, /pose/u);
    assert.match(
      buildSubjectPrompt("sit down", "action", "flat").user,
      /action/u,
    );
    assert.match(buildSubjectPrompt("under", "figure", "flat").user, /figure/u);
    assert.match(buildSubjectPrompt("book", "photo", "flat").user, /photo/u);
  });

  test("asks for English, which is the language of the picture, not of the teacher", () => {
    const { user } = buildSubjectPrompt("book", "photo", "flat");
    assert.match(user, /in English/iu);
  });

  /*
   * Each kind has to ask for something different, or the category would be
   * named in the prompt and ignored in the answer.
   */
  test("describes a different shape for each kind", () => {
    const shapes = KINDS.map(
      (kind) => buildSubjectPrompt("x", kind, "flat").user,
    );
    assert.equal(new Set(shapes).size, shapes.length);
    assert.match(buildSubjectPrompt("x", "pose", "flat").user, /at rest/iu);
    assert.match(buildSubjectPrompt("x", "action", "flat").user, /doing/iu);
    assert.match(buildSubjectPrompt("x", "figure", "flat").user, /no person/iu);
    assert.match(buildSubjectPrompt("x", "photo", "flat").user, /on its own/iu);
  });

  /*
   * The rules bought with real generations on 2026-09-19. Held by identity
   * against learnedRules and not by matching a phrase, so a rule cannot be
   * dropped from the prompt while a test that looks like it covers it goes on
   * passing.
   */
  test("carries every rule that was learned, whatever the kind or style", () => {
    for (const style of STYLES) {
      for (const kind of KINDS) {
        const { system } = buildSubjectPrompt("book", kind, style);
        for (const rule of learnedRules(style)) {
          assert.ok(
            system.includes(rule),
            `${style}/${kind} is missing a rule`,
          );
        }
      }
    }
  });

  test("there are four of them, numbered, and each says something", () => {
    for (const style of STYLES) {
      const rules = learnedRules(style);
      assert.equal(rules.length, 4, style);
      const { system } = buildSubjectPrompt("book", "photo", style);
      for (const [index, rule] of rules.entries()) {
        assert.ok(
          rule.trim().length > 80,
          `${style} rule ${index + 1} is thin`,
        );
        assert.ok(
          system.includes(`${index + 1}. ${rule}`),
          `${style} rule ${index + 1} is unnumbered`,
        );
      }
    }
  });

  /*
   * Each rule named by the thing it is about, so that losing one is a failure
   * here rather than a picture that quietly goes back to being wrong.
   *
   * The angle and the adjective are the same question whatever the picture is
   * made of, so both styles are asserted. The middle rule is not, which is
   * what the test after this one is about.
   */
  test("names the angle and the trap of the adjective, in both styles", () => {
    for (const style of STYLES) {
      const { system } = buildSubjectPrompt("closed", "photo", style);
      assert.match(system, /seen from the side/iu, style);
      assert.match(system, /do not use the adjective/iu, style);
    }
  });

  /*
   * 2026-09-22: large, small, long and short came back as two objects in one
   * scene in 12 answers of 12 ("a tiny cube beside a giant cube"), a leftover
   * of solving contrast inside one picture. Contrast is between pictures now
   * (0022), so every subject shows one thing, whatever the word, the kind or
   * the style, and nothing here reads contrast_sets.
   */
  test("asks for one subject and never a comparison, in every kind and style", () => {
    for (const style of STYLES) {
      for (const kind of KINDS) {
        const { system } = buildSubjectPrompt("large", kind, style);
        assert.match(system, /one subject/iu, `${style}/${kind}`);
        assert.match(
          system,
          /never both in the same scene/iu,
          `${style}/${kind}`,
        );
      }
    }
  });

  /*
   * 2026-09-22, the same day: one subject alone lets "one huge cube" and "a
   * single tiny cube" come out as the same picture, each filling the frame,
   * and side by side in a set they would show no difference. With no second
   * object to measure against, the frame is the yardstick.
   */
  test("lets the frame carry size and length, in every kind and style", () => {
    for (const style of STYLES) {
      for (const kind of KINDS) {
        const { system } = buildSubjectPrompt("small", kind, style);
        assert.match(
          system,
          /the frame is the yardstick/iu,
          `${style}/${kind}`,
        );
        assert.match(
          system,
          /fills almost the whole frame/iu,
          `${style}/${kind}`,
        );
        assert.match(system, /nearly empty frame/iu, `${style}/${kind}`);
      }
    }
  });

  /*
   * The realistic recognition rule said a photograph is known "by its size
   * next to something familiar", which invites the very reference object the
   * one subject rule forbids. Scale is still how a photograph reads; what it
   * is read against is the frame.
   */
  test("never asks the realistic style for a familiar object beside it", () => {
    const { system } = buildSubjectPrompt("large", "figure", "realistic");
    assert.doesNotMatch(system, /next to something familiar/iu);
    assert.match(system, /never from an object placed beside it/iu);
  });

  /*
   * 2026-09-20, and a reading rather than a measurement.
   *
   * The silhouette rule is right about a flat vector, where there is no
   * texture, no light and no depth and the outline is the whole picture. Sent
   * to a photograph it asks for the wrong criterion, and on the words the
   * realistic style exists for it asks for one that does not exist: a room
   * and a ceiling have no silhouette. A model told to find the clearest
   * outline of a room has an obvious way out, which is to answer with an
   * object standing in the room, and that is the failure the second style was
   * added to stop.
   */
  test("asks for the silhouette in flat, and never in realistic", () => {
    const flat = buildSubjectPrompt("book", "photo", "flat").system;
    assert.match(flat, /most recognisable silhouette/iu);

    const realistic = buildSubjectPrompt("room", "photo", "realistic").system;
    assert.doesNotMatch(realistic, /silhouette/iu);
    assert.match(realistic, /material, scale and context/iu);
    assert.match(realistic, /no outline to choose a view for/iu);
    // The way out that has to be closed: the place answered with a thing.
    assert.match(realistic, /stand in for the place/iu);
  });

  test("asks for json and caps the length", () => {
    const { system } = buildSubjectPrompt("book", "photo", "flat");
    assert.match(system, /json/iu);
    assert.match(system, /at most 12 words/iu);
  });

  /*
   * Measured against the live model on 2026-09-19: without this line, "book"
   * came back as "a closed hardcover book on a plain white background". The
   * style constant already fixes a warm off-white background, so the subject
   * was arguing with it. With the line, the same word answers "a single
   * closed hardcover book with a plain cover".
   *
   * 2026-09-20: the line used to say that the background, the colours and the
   * drawing style were all fixed elsewhere. Two of those survive a
   * photographic style and one does not, and the background was the worse
   * half: a room and a ceiling are words whose surroundings are the subject,
   * and the line told the model not to describe them. What stays is what is
   * true in both styles, that the medium and the colours are not the
   * subject's business. What a book must not come back with is now said by
   * naming the book, rather than by forbidding every background there is.
   */
  test("keeps the medium and the colours out of the subject", () => {
    for (const style of STYLES) {
      const { system } = buildSubjectPrompt("book", "photo", style);
      assert.match(system, /never how it is made/iu, style);
      assert.match(system, /do not choose a palette/iu, style);
      assert.match(
        system,
        /do not write drawing, illustration, photograph/iu,
        style,
      );
    }
  });

  test("leaves the surroundings to the words that are about them", () => {
    for (const style of STYLES) {
      const { system } = buildSubjectPrompt("room", "photo", style);
      assert.match(system, /when the word names a place/iu, style);
      // And the measurement of 19/09 that the old line existed for.
      assert.match(system, /a book needs no background/iu, style);
    }
  });

  test("refuses a kind that has no picture, and an empty word", () => {
    assert.throws(() => buildSubjectPrompt("six", "symbol", "flat"), /symbol/);
    assert.throws(() => buildSubjectPrompt("the", "none", "flat"), /none/);
    assert.throws(() => buildSubjectPrompt("  ", "photo", "flat"), /word/);
  });
});

describe("parseSubject", () => {
  test("reads the phrase", () => {
    assert.equal(
      parseSubject('{"subject": "a black umbrella"}'),
      "a black umbrella",
    );
  });

  test("unwraps a fenced block and strips stray quotes", () => {
    assert.equal(
      parseSubject('```json\n{"subject": "\'a red book\'"}\n```'),
      "a red book",
    );
  });

  /*
   * A refusal leaves the teacher typing, which is what they were doing
   * anyway, so nothing here throws.
   */
  /*
   * Every medium in STYLES brings a full stop of its own, so a phrase that
   * ends in one produces two. The example is what deepseek-flash actually
   * answered for `under` on 2026-09-19.
   */
  test("drops a full stop the medium prompt is about to add again", () => {
    assert.equal(
      parseSubject(
        '{"subject": "A ball directly beneath a raised horizontal bar, seen from the side."}',
      ),
      "A ball directly beneath a raised horizontal bar, seen from the side",
    );
  });

  test("drops it through a trailing space, a run of them, and a quote", () => {
    assert.equal(parseSubject('{"subject": "an open book. "}'), "an open book");
    assert.equal(
      parseSubject('{"subject": "an open book..."}'),
      "an open book",
    );
    assert.equal(
      parseSubject('{"subject": "\'an open book.\'"}'),
      "an open book",
    );
  });

  test("leaves a full stop that is not at the end alone", () => {
    assert.equal(
      parseSubject('{"subject": "a 2.5 litre bottle on a table"}'),
      "a 2.5 litre bottle on a table",
    );
  });

  /*
   * The capital stays. Lowercasing the first letter would look like tidying
   * and would be wrong about the word on exactly the subjects where the
   * capital carries the meaning: a proper noun in lower case is a content
   * error, where a capital mid-phrase is only ugly.
   */
  test("never touches the capital, because Jack is not jack", () => {
    assert.equal(
      parseSubject(
        '{"subject": "a young man named Jack, seen from the side."}',
      ),
      "a young man named Jack, seen from the side",
    );
    assert.equal(
      parseSubject(
        '{"subject": "Mr Brown standing beside a door in England."}',
      ),
      "Mr Brown standing beside a door in England",
    );
    assert.equal(
      parseSubject('{"subject": "A ball under a table."}'),
      "A ball under a table",
    );
  });

  test("a phrase that is nothing but a full stop is not a phrase", () => {
    assert.equal(parseSubject('{"subject": "."}'), null);
    assert.equal(parseSubject('{"subject": "  ...  "}'), null);
  });

  test("returns null for anything that is not a phrase", () => {
    for (const junk of [
      "",
      "not json",
      "{}",
      '{"subject": 12}',
      '{"subject": ""}',
      '{"subject": "   "}',
      '{"phrase": "a book"}',
      "[]",
    ]) {
      assert.equal(parseSubject(junk), null, junk);
    }
  });
});
