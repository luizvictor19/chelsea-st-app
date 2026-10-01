import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CHANGED_ELSEWHERE,
  EMPTY,
  cleaned,
  isAnswerLanguage,
  isDirty,
  parseFields,
  questionError,
  refusal,
  type QuestionFields,
} from "./draft.ts";

const SAVED: QuestionFields = {
  prompt: "Is this a lamp?",
  expectedAnswer: "Yes, it's a lamp.",
  answerLanguage: "en",
  isPublished: false,
};

describe("a question draft", () => {
  test("starts in English and unpublished", () => {
    assert.deepEqual(EMPTY, {
      prompt: "",
      expectedAnswer: "",
      answerLanguage: "en",
      isPublished: false,
    });
  });

  test("is refused without a question, then without an answer", () => {
    assert.equal(refusal(EMPTY), "Escreva a pergunta");
    assert.equal(refusal({ ...EMPTY, prompt: "   " }), "Escreva a pergunta");
    assert.equal(
      refusal({ ...EMPTY, prompt: "Is this a lamp?", expectedAnswer: " " }),
      "Escreva a resposta esperada",
    );
    assert.equal(refusal(SAVED), null);
  });

  test("is stored without the space around either sentence", () => {
    assert.deepEqual(
      cleaned({
        ...SAVED,
        prompt: "  Is this a lamp? ",
        expectedAnswer: "Yes \n",
      }),
      { ...SAVED, prompt: "Is this a lamp?", expectedAnswer: "Yes" },
    );
  });

  test("is dirty when any of the four fields differs", () => {
    assert.equal(isDirty(SAVED, SAVED), false);
    assert.equal(
      isDirty({ ...SAVED, prompt: "Is this a shelf?" }, SAVED),
      true,
    );
    assert.equal(isDirty({ ...SAVED, expectedAnswer: "No." }, SAVED), true);
    assert.equal(isDirty({ ...SAVED, answerLanguage: "pt" }, SAVED), true);
    assert.equal(isDirty({ ...SAVED, isPublished: true }, SAVED), true);
  });

  test("is not dirty for a space a save would drop", () => {
    assert.equal(
      isDirty({ ...SAVED, prompt: "Is this a lamp? " }, SAVED),
      false,
    );
  });
});

describe("parseFields", () => {
  test("accepts the four fields and nothing less", () => {
    assert.deepEqual(parseFields(SAVED), SAVED);
    assert.equal(parseFields(null), null);
    assert.equal(parseFields("Is this a lamp?"), null);
    assert.equal(parseFields({ ...SAVED, prompt: 3 }), null);
    assert.equal(parseFields({ ...SAVED, expectedAnswer: undefined }), null);
    assert.equal(parseFields({ ...SAVED, isPublished: "true" }), null);
  });

  test("refuses a language the database does not list", () => {
    assert.equal(parseFields({ ...SAVED, answerLanguage: "fr" }), null);
    assert.equal(isAnswerLanguage("pt"), true);
    assert.equal(isAnswerLanguage("PT"), false);
  });

  test("drops anything else it is handed", () => {
    assert.deepEqual(parseFields({ ...SAVED, position: 9 }), SAVED);
  });
});

describe("questionError", () => {
  test("a stale order and a taken position are the same news", () => {
    assert.equal(questionError("anything", "QS001"), CHANGED_ELSEWHERE);
    assert.equal(questionError("duplicate key", "23505"), CHANGED_ELSEWHERE);
  });

  test("a question a student holds says how to retire it", () => {
    assert.match(
      questionError("violates foreign key constraint", "23503"),
      /desmarque Publicada/,
    );
  });

  test("a question that is gone says to reload", () => {
    assert.match(
      questionError("question 1ce280b7 not found", "P0001"),
      /não existe mais/,
    );
  });

  test("an unknown refusal is passed through as it came", () => {
    assert.equal(
      questionError("permission denied", "42501"),
      "permission denied",
    );
  });
});
