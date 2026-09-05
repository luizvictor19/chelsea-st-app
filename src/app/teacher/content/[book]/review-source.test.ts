import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  headingFor,
  writtenNumbers,
  type ReviewSourcePage,
} from "./review-source.ts";

function page(overrides: Partial<ReviewSourcePage> = {}): ReviewSourcePage {
  return {
    id: "p117-118.png",
    fileName: "p117-118.png",
    uploadIndex: 0,
    points: [117],
    placements: [{ number: 117, y: 80 }],
    inheritedPoint: null,
    duplicateOf: null,
    lessonNumber: 22,
    disputes: [],
    unsupported: null,
    refused: false,
    blocks: [],
    savedPoints: [],
    changedSinceSaving: false,
    hasImage: true,
    ...overrides,
  } as ReviewSourcePage;
}

describe("writtenNumbers", () => {
  test("an answered dispute is named alongside the settled number", () => {
    // The page writes both. Reading the heading off the settled numbers alone
    // named only one of them, and for a spread it named the wrong one.
    const spread = page({
      points: [117],
      disputes: [{ y: 1219, candidates: [118, 119] }],
    });
    assert.deepEqual(writtenNumbers(spread, 118, false), [117, 118]);
    assert.equal(headingFor(spread, 118, false), "Pontos 117 e 118");
  });

  test("a page that settled both keeps both", () => {
    const both = page({ points: [117, 118] });
    assert.equal(headingFor(both, 117, false), "Pontos 117 e 118");
  });

  test("a page with one number reads as one", () => {
    assert.equal(headingFor(page({ points: [121] }), 121, false), "Ponto 121");
  });

  test("a continuation belongs to one point, whatever the page settled", () => {
    const carried = page({ points: [], placements: [], inheritedPoint: 118 });
    assert.deepEqual(writtenNumbers(carried, 118, true), [118]);
    assert.equal(headingFor(carried, 118, true), "Continuação do ponto 118");
  });

  test("unanswered stays a state of its own", () => {
    const unresolved = page({
      points: [],
      placements: [],
      disputes: [{ y: 300, candidates: [4, 45, 74] }],
    });
    assert.deepEqual(writtenNumbers(unresolved, null, false), []);
    assert.equal(
      headingFor(unresolved, null, false),
      "Número do ponto não resolvido",
    );
  });
});
