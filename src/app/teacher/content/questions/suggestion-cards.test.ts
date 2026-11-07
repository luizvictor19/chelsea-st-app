import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SuggestedQuestion } from "./suggest-flow.ts";
import {
  DEFAULT_COUNT,
  countOf,
  draftToFields,
  provenance,
  putBack,
  removed,
  used,
  withAnswer,
  type SuggestionCard,
} from "./suggestion-cards.ts";

const MODEL = "claude-haiku-5-5";
const WORD = "0f3c2a4e-1b2d-4c5e-8f90-112233445566";
const SCENE = "7a8b9c0d-1e2f-4a3b-9c4d-5e6f70819203";

const draft = (
  prompt: string,
  expectedAnswer: string,
  extra: Partial<SuggestedQuestion> = {},
): SuggestedQuestion => ({
  prompt,
  expectedAnswer,
  answerLanguage: "en",
  image: { kind: "word", id: WORD },
  practises: "is it a",
  marks: [],
  ...extra,
});

const PEN = draft("Is it a pen?", "Yes, it's a pen.");
const BOOK = draft("Is it a book?", "No, it isn't. It's a pen.");
const WHERE = draft("Where's the pen?", "It's in the box.", {
  image: { kind: "new_scene", description: "a pen in a box" },
});

describe("withAnswer", () => {
  test("the drafts become cards, in the model's order, none in use", () => {
    const { cards, added } = withAnswer([], MODEL, [PEN, BOOK]);
    assert.equal(added, 2);
    assert.deepEqual(
      cards.map((card) => [card.question.prompt, card.model, card.inUse]),
      [
        ["Is it a pen?", MODEL, false],
        ["Is it a book?", MODEL, false],
      ],
    );
    assert.notEqual(cards[0].key, cards[1].key);
  });

  test("a second answer adds after the cards on screen and replaces none", () => {
    const first = withAnswer([], MODEL, [PEN]).cards;
    const inUse = used(first, first[0].key);
    const { cards, added } = withAnswer(inUse, MODEL, [BOOK, WHERE]);
    assert.equal(added, 2);
    assert.equal(cards[0], inUse[0]);
    assert.deepEqual(
      cards.map((card) => card.question.prompt),
      ["Is it a pen?", "Is it a book?", "Where's the pen?"],
    );
  });

  test("a draft equal to a card on screen, or repeated in the answer, adds nothing", () => {
    const first = withAnswer([], MODEL, [PEN]).cards;
    const again = draft(" Is it a pen?", "Yes, it's a pen. ");
    const { cards, added } = withAnswer(first, MODEL, [again, BOOK, BOOK]);
    assert.equal(added, 1);
    assert.deepEqual(
      cards.map((card) => card.question.prompt),
      ["Is it a pen?", "Is it a book?"],
    );
  });

  test("the same question with another answer is another card", () => {
    const other = draft("Is it a pen?", "No, it isn't.");
    assert.equal(
      withAnswer(withAnswer([], MODEL, [PEN]).cards, MODEL, [other]).added,
      1,
    );
  });
});

describe("used, putBack, removed", () => {
  const cards = withAnswer([], MODEL, [PEN, BOOK, WHERE]).cards;
  const [pen, book, where] = cards;

  test("Usar opens only that card, and leaves the others as they were", () => {
    const after = used(cards, book.key);
    assert.deepEqual(
      after.map((card) => card.inUse),
      [false, true, false],
    );
    assert.equal(after[0], pen);
  });

  test("closing the form puts the card back, with the draft as the model wrote it", () => {
    const after = putBack(used(cards, book.key), book.key);
    assert.deepEqual(after, cards);
  });

  test("Descartar and a save take the card away, and only that one", () => {
    const after = removed(used(cards, where.key), where.key);
    assert.deepEqual(after, [pen, book]);
    assert.deepEqual(removed(after, "sugestao-que-nao-existe"), after);
  });
});

describe("countOf", () => {
  test("starts at 6, which it takes", () => {
    assert.equal(DEFAULT_COUNT, 6);
    assert.equal(countOf(String(DEFAULT_COUNT)), 6);
  });

  test("a whole number from 1 to 20 is taken, spaces around it too", () => {
    assert.equal(countOf("1"), 1);
    assert.equal(countOf(" 20 "), 20);
  });

  test("anything else is not a quantity", () => {
    for (const typed of ["", "0", "21", "6.5", "-3", "seis", "1e1"]) {
      assert.equal(countOf(typed), null, typed);
    }
  });
});

describe("draftToFields", () => {
  test("a word opens chosen, unpublished, with the draft's sentences", () => {
    assert.deepEqual(draftToFields(PEN), {
      fields: {
        prompt: "Is it a pen?",
        expectedAnswer: "Yes, it's a pen.",
        answerLanguage: "en",
        isPublished: false,
        image: { kind: "word", id: WORD },
      },
      sceneText: null,
    });
  });

  test("a scene in use opens chosen", () => {
    const opened = draftToFields(
      draft("Where's the pen?", "It's on the table.", {
        image: { kind: "scene", id: SCENE },
      }),
    );
    assert.deepEqual(opened.fields.image, { kind: "scene", id: SCENE });
    assert.equal(opened.sceneText, null);
  });

  test("a new scene opens as a scene to pick, with Criar cena written", () => {
    const opened = draftToFields(WHERE);
    assert.deepEqual(opened.fields.image, { kind: "scene", id: null });
    assert.equal(opened.sceneText, "a pen in a box");
  });

  test("acted out opens as Encenar", () => {
    const opened = draftToFields(
      draft("Is she Ana?", "Yes, she is.", {
        image: { kind: "acted" },
      }),
    );
    assert.deepEqual(opened.fields.image, { kind: "acted" });
  });

  test("a picture that does not exist opens as nothing decided", () => {
    const opened = draftToFields(
      draft("Is it a cup?", "Yes, it is.", {
        image: { kind: "none", reason: "a cena sugerida não existe" },
      }),
    );
    assert.deepEqual(opened.fields.image, { kind: "none" });
    assert.equal(opened.sceneText, null);
  });

  test("a Portuguese answer keeps its language", () => {
    const opened = draftToFields(
      draft("What's pen in Portuguese?", "Caneta.", { answerLanguage: "pt" }),
    );
    assert.equal(opened.fields.answerLanguage, "pt");
  });
});

describe("provenance", () => {
  test("the model and the sentences as the model wrote them, not as edited", () => {
    const [card]: readonly SuggestionCard[] = withAnswer([], MODEL, [
      PEN,
    ]).cards;
    assert.deepEqual(provenance(card), {
      model: MODEL,
      prompt: "Is it a pen?",
      answer: "Yes, it's a pen.",
    });
  });
});
