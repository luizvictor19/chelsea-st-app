import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PictureOf, QuestionFields } from "./draft.ts";
import { leftOutList, sortDrafts, type Draft } from "./publish-reviewed.ts";

const WORD = "0f3c2a4e-1b2d-4c5e-8f90-112233445566";
const BARE_WORD = "1f3c2a4e-1b2d-4c5e-8f90-112233445566";
const SCENE = "7a8b9c0d-1e2f-4a3b-9c4d-5e6f70819203";
const BARE_SCENE = "8a8b9c0d-1e2f-4a3b-9c4d-5e6f70819203";

/** The word and the scene with an approved picture; the bare ones without. */
const pictureOf: PictureOf = (kind, id) =>
  (kind === "word" && id === WORD) || (kind === "scene" && id === SCENE)
    ? "https://example.com/picture.png"
    : null;

const fields = (extra: Partial<QuestionFields> = {}): QuestionFields => ({
  prompt: "Is it a pen?",
  expectedAnswer: "Yes, it's a pen.",
  answerLanguage: "en",
  isPublished: false,
  image: { kind: "word", id: WORD },
  ...extra,
});

const draft = (number: number, extra: Partial<QuestionFields> = {}): Draft => ({
  id: `q${number}`,
  number,
  fields: fields(extra),
});

describe("sortDrafts", () => {
  test("a draft with an approved picture, or acted out, is ready", () => {
    const sorted = sortDrafts(
      [
        draft(1),
        draft(2, { image: { kind: "scene", id: SCENE } }),
        draft(3, { image: { kind: "acted" } }),
      ],
      pictureOf,
    );
    assert.deepEqual(
      sorted.ready.map((one) => one.id),
      ["q1", "q2", "q3"],
    );
    assert.deepEqual(sorted.left, []);
  });

  test("a draft the form would refuse to publish is left out, with the reason", () => {
    const sorted = sortDrafts(
      [
        draft(1, { image: { kind: "none" } }),
        draft(2, { image: { kind: "word", id: BARE_WORD } }),
        draft(3, { image: { kind: "scene", id: BARE_SCENE } }),
        draft(4, { image: { kind: "scene", id: null } }),
        draft(5, { prompt: "  " }),
      ],
      pictureOf,
    );
    assert.deepEqual(sorted.ready, []);
    assert.deepEqual(sorted.left, [
      { number: 1, reason: "sem imagem decidida" },
      { number: 2, reason: "a palavra não tem imagem aprovada" },
      { number: 3, reason: "a cena não tem imagem aprovada" },
      { number: 4, reason: "a cena não tem imagem aprovada" },
      { number: 5, reason: "sem pergunta ou resposta" },
    ]);
  });

  test("a published question is neither ready nor left out", () => {
    const sorted = sortDrafts(
      [
        draft(1, { isPublished: true }),
        draft(2, { isPublished: true, image: { kind: "none" } }),
      ],
      pictureOf,
    );
    assert.deepEqual(sorted, { ready: [], left: [] });
  });

  test("the point's order is kept on both sides", () => {
    const sorted = sortDrafts(
      [
        draft(1),
        draft(2, { image: { kind: "none" } }),
        draft(3),
        draft(4, { image: { kind: "none" } }),
      ],
      pictureOf,
    );
    assert.deepEqual(
      sorted.ready.map((one) => one.number),
      [1, 3],
    );
    assert.deepEqual(
      sorted.left.map((one) => one.number),
      [2, 4],
    );
  });
});

describe("leftOutList", () => {
  test("each draft by its number, with its reason", () => {
    assert.equal(
      leftOutList([
        { number: 2, reason: "sem imagem decidida" },
        { number: 4, reason: "a cena não tem imagem aprovada" },
      ]),
      "2 (sem imagem decidida), 4 (a cena não tem imagem aprovada)",
    );
  });
});
