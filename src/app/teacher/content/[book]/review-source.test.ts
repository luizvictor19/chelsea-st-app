import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  authoredPoints,
  headingFor,
  targetsOf,
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
    openingPoint: null,
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

  test("only the page's own numbers may be replaced, never the one before", () => {
    // targetsOf names every point the page writes to, which is what the check
    // for "this point already holds content" has to see. What may be replaced
    // is narrower: the opening point belongs to the page before, and this page
    // only adds to it.
    const opening = page({
      points: [116],
      placements: [{ number: 116, y: 663 }],
      openingPoint: 115,
      blocks: [
        {
          kind: "vocabulary",
          content: "cheap",
          needsReview: false,
          crop: null,
          top: 62,
        },
      ],
    });
    assert.deepEqual(targetsOf(opening), [115, 116]);
    assert.deepEqual(authoredPoints(opening), [116]);
    const carried = page({ points: [], placements: [], inheritedPoint: 118 });
    assert.deepEqual(authoredPoints(carried), [118]);
  });

  test("a page also names the point it opens in, when it writes there", () => {
    // p116 of book 2: two panels printed above its only margin number, both
    // belonging to 115. The page writes to 115 as well as to 116, and saying
    // only "Ponto 116" is the half of the truth that hides the other point.
    const opening = page({
      id: "p116.png",
      fileName: "p116.png",
      points: [116],
      placements: [{ number: 116, y: 663 }],
      openingPoint: 115,
      blocks: [
        {
          kind: "vocabulary",
          content: "cheap",
          needsReview: false,
          crop: null,
          top: 62,
        },
        {
          kind: "vocabulary",
          content: "the fewest",
          needsReview: false,
          crop: null,
          top: 347,
        },
        {
          kind: "vocabulary",
          content: "building",
          needsReview: false,
          crop: null,
          top: 814,
        },
      ],
    });
    assert.deepEqual(targetsOf(opening), [115, 116]);
    assert.deepEqual(writtenNumbers(opening, 116, false), [115, 116]);
    assert.equal(headingFor(opening, 116, false), "Pontos 115 e 116");
  });

  test("a page keeps naming only its own number when nothing spills up", () => {
    const tidy = page({
      points: [117],
      placements: [{ number: 117, y: 80 }],
      openingPoint: 116,
      blocks: [
        {
          kind: "vocabulary",
          content: "a, some",
          needsReview: false,
          crop: null,
          top: 64,
        },
      ],
    });
    assert.deepEqual(targetsOf(tidy), [117]);
    assert.equal(headingFor(tidy, 117, false), "Ponto 117");
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
