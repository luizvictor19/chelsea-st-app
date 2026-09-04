import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { classify, slashRatio, type ClassifyInput } from "./classify.ts";
import { TABLE_HEIGHT } from "./constants.ts";

function input(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    boxes: [],
    explanations: [],
    pageText: "",
    tokens: [],
    ...overrides,
  };
}

function supported(result: ReturnType<typeof classify>) {
  assert.equal(result.supported, true);
  return result;
}

describe("classify", () => {
  test("a short panel is vocabulary and is trusted", () => {
    const result = supported(
      classify(
        input({
          boxes: [{ band: { top: 100, bottom: 160 }, content: "see such as" }],
        }),
      ),
    );
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0].kind, "vocabulary");
    assert.equal(result.blocks[0].needsReview, false);
  });

  test("criterion 5: a tall panel is a table and is flagged for review", () => {
    const result = supported(
      classify(
        input({
          boxes: [
            {
              band: { top: 100, bottom: 100 + TABLE_HEIGHT + 1 },
              content: "flattened grid",
            },
          ],
        }),
      ),
    );
    assert.equal(result.blocks[0].kind, "grammar_table");
    assert.equal(result.blocks[0].needsReview, true);
  });

  test("a revision exercise page is refused rather than ingested", () => {
    // Most of such a page is shaded, so the band detector returns one enormous
    // box. Reading it would store the whole page as a single unusable table.
    const result = classify(
      input({ pageText: "Revision Exercise 6 (Lessons 21 - 24) 1 What is" }),
    );
    assert.equal(result.supported, false);
    assert.equal(result.reason, "revision_exercise");
  });

  test("the loose marker on an ordinary page is not the heading", () => {
    // Four legitimate dictation pages carry this. Refusing them would throw
    // away real content.
    const result = supported(
      classify(input({ pageText: "Do Revision Exercise 4 after this lesson" })),
    );
    assert.deepEqual(
      result.blocks.map((b) => [b.kind, b.content]),
      [["revision_exercise", "Revision Exercise 4"]],
    );
  });

  test("criterion 8: a dictation keeps its slashes", () => {
    const spoken = "the man / who lives / next door";
    const result = supported(
      classify(
        input({
          tokens: spoken.split(" "),
          explanations: [{ band: { top: 200, bottom: 240 }, content: spoken }],
        }),
      ),
    );
    const dictation = result.blocks.filter((b) => b.kind === "dictation");
    assert.equal(dictation.length, 1);
    assert.equal(dictation[0].content, spoken);
    assert.equal(result.isDictation, true);
  });

  test("criterion 7: adjacent justified lines become one explanation block", () => {
    const result = supported(
      classify(
        input({
          explanations: [
            { band: { top: 100, bottom: 120 }, content: "we use into" },
            { band: { top: 122, bottom: 142 }, content: "to show movement" },
          ],
        }),
      ),
    );
    const explanations = result.blocks.filter((b) => b.kind === "explanation");
    assert.equal(explanations.length, 1);
    assert.equal(explanations[0].content, "we use into to show movement");
  });

  test("paragraphs separated by a blank stay separate blocks", () => {
    const result = supported(
      classify(
        input({
          explanations: [
            { band: { top: 100, bottom: 120 }, content: "first" },
            { band: { top: 300, bottom: 320 }, content: "second" },
          ],
        }),
      ),
    );
    assert.equal(
      result.blocks.filter((b) => b.kind === "explanation").length,
      2,
    );
  });

  test("a line inside a panel does not become a second block", () => {
    // The line finder reports panel text too, since the letters are ink. It is
    // already captured as the box's content.
    const result = supported(
      classify(
        input({
          boxes: [{ band: { top: 90, bottom: 160 }, content: "home speak" }],
          explanations: [
            { band: { top: 110, bottom: 130 }, content: "home speak" },
          ],
        }),
      ),
    );
    assert.deepEqual(
      result.blocks.map((b) => b.kind),
      ["vocabulary"],
    );
  });

  test("lesson headers and chart references are picked up", () => {
    const result = supported(
      classify(input({ pageText: "LESSON 17 ... See Chart 9" })),
    );
    assert.deepEqual(result.lessonHeaders, [17]);
    assert.deepEqual(
      result.blocks.map((b) => b.kind),
      ["chart_ref"],
    );
  });

  test("blocks come back in the order they sit on the page", () => {
    const result = supported(
      classify(
        input({
          boxes: [
            { band: { top: 400, bottom: 460 }, content: "second" },
            { band: { top: 100, bottom: 160 }, content: "first" },
          ],
        }),
      ),
    );
    assert.deepEqual(
      result.blocks.map((b) => b.content),
      ["first", "second"],
    );
  });

  test("slashRatio separates dictation from ordinary prose", () => {
    assert.equal(slashRatio([]), 0);
    assert.equal(slashRatio(["a", "b/c", "d", "e"]), 0.25);
    assert.equal(slashRatio(["a", "b", "c", "d"]), 0);
  });
});
