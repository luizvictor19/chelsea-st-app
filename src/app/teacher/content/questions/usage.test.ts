import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createUsageReader } from "../../../../lib/questions/word-usage.ts";

import {
  bandLabel,
  chipTitle,
  draftLights,
  earlierLessons,
  lessonMean,
  meanSentence,
} from "./usage.ts";

describe("chipTitle", () => {
  test("a word with no question says so, and gives no count", () => {
    assert.equal(
      chipTitle("pen", { published: 0, unpublished: 0 }, "none", null),
      "pen · sem pergunta",
    );
  });

  test("a used word says its count, the split and the band", () => {
    assert.equal(
      chipTitle("pen", { published: 2, unpublished: 1 }, "medium", null),
      "pen · 3 perguntas (2 publicadas, 1 não publicada) · uso médio",
    );
    assert.equal(
      chipTitle("pen", { published: 1, unpublished: 0 }, "low", null),
      "pen · 1 pergunta (1 publicada, 0 não publicadas) · pouco usada",
    );
  });

  test("a lit word says what the open draft does to it", () => {
    assert.equal(
      chipTitle("pen", { published: 0, unpublished: 0 }, "none", 1),
      "pen · sem pergunta · o rascunho aberto soma 1",
    );
    assert.equal(
      chipTitle("pen", { published: 9, unpublished: 0 }, "high", 0),
      "pen · 9 perguntas (9 publicadas, 0 não publicadas) · muito usada · o rascunho aberto usa esta palavra",
    );
  });

  test("every band has a name", () => {
    assert.deepEqual(
      (["none", "low", "medium", "high"] as const).map(bandLabel),
      ["sem pergunta", "pouco usada", "uso médio", "muito usada"],
    );
  });
});

describe("meanSentence", () => {
  test("says the mean and where the two lines fall", () => {
    assert.equal(
      meanSentence(2.25),
      "Média da lição: 2,3 por palavra. Pouco usada abaixo de 1,1, muito usada acima de 4,5.",
    );
  });

  test("a lesson with no question has no mean to say", () => {
    assert.equal(
      meanSentence(0),
      "Nenhuma palavra desta lição tem pergunta ainda.",
    );
  });
});

describe("lessonMean", () => {
  test("counts the words no question uses as zero", () => {
    const usage = new Map([
      ["a", { published: 2, unpublished: 1 }],
      ["b", { published: 0, unpublished: 1 }],
    ]);
    assert.equal(lessonMean(["a", "b", "c", "d"], usage), 1);
    assert.equal(lessonMean([], usage), 0);
  });
});

describe("earlierLessons", () => {
  const points = [
    { number: 9, lesson: 2 },
    { number: 1, lesson: 1 },
    { number: 2, lesson: 1 },
    { number: 8, lesson: 2 },
    { number: 14, lesson: 3 },
    { number: 30, lesson: null },
  ];

  test("lists the lessons before, in order, with their points", () => {
    assert.deepEqual(earlierLessons(points, 3), [
      { lesson: 1, points: [1, 2] },
      { lesson: 2, points: [8, 9] },
    ]);
  });

  test("the first lesson has none before it", () => {
    assert.deepEqual(earlierLessons(points, 1), []);
  });
});

describe("draftLights", () => {
  const reader = createUsageReader(
    ["a", "pen", "book", "is this?"].map((term) => ({
      id: term,
      term,
      wordClass: null,
    })),
  );
  const sentences = (prompt: string, expectedAnswer: string) => ({
    prompt,
    expectedAnswer,
    answerLanguage: "en" as const,
  });

  test("a new question adds one to every word it uses", () => {
    const lights = draftLights(reader, [
      { saved: null, draft: sentences("Is this a pen?", "a pen") },
    ]);
    assert.deepEqual([...lights].sort(), [
      ["a", 1],
      ["is this?", 1],
      ["pen", 1],
    ]);
  });

  test("an edit adds only to the words the stored question lacks", () => {
    const lights = draftLights(reader, [
      {
        saved: sentences("Is this a pen?", "a pen"),
        draft: sentences("Is this a book?", "a book"),
      },
    ]);
    assert.deepEqual([...lights].sort(), [
      ["a", 0],
      ["book", 1],
      ["is this?", 0],
    ]);
  });

  test("two open forms add up", () => {
    const lights = draftLights(reader, [
      { saved: null, draft: sentences("a pen", "") },
      { saved: null, draft: sentences("a book", "") },
    ]);
    assert.equal(lights.get("a"), 2);
    assert.equal(lights.get("pen"), 1);
  });

  test("an empty form lights nothing", () => {
    assert.equal(
      draftLights(reader, [{ saved: null, draft: sentences("", "") }]).size,
      0,
    );
  });
});
