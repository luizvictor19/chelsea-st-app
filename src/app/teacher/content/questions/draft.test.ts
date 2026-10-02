import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CHANGED_ELSEWHERE,
  EMPTY,
  SESSION_ENDED,
  cleaned,
  closed,
  deleteError,
  failureMessage,
  isAnswerLanguage,
  isDirty,
  opened,
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
  shownWordId: null,
};

const LAMP = "0b5c1f7e-3c0a-4a51-9d0e-6a4f2f1f0a11";
const SHELF = "7d2e9a44-1b6f-4c3d-8e2a-5f9b0c1d2e33";

describe("a question draft", () => {
  test("starts in English, unpublished and showing no word", () => {
    assert.deepEqual(EMPTY, {
      prompt: "",
      expectedAnswer: "",
      answerLanguage: "en",
      isPublished: false,
      shownWordId: null,
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

  test("is dirty when the word it shows is chosen, changed or taken off", () => {
    const shown = { ...SAVED, shownWordId: LAMP };
    assert.equal(isDirty(shown, SAVED), true);
    assert.equal(isDirty({ ...shown, shownWordId: SHELF }, shown), true);
    assert.equal(isDirty(SAVED, shown), true);
    assert.equal(isDirty(shown, shown), false);
  });

  test("is dirty when any of the other four fields differs", () => {
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
  test("accepts the fields and nothing less", () => {
    assert.deepEqual(parseFields(SAVED), SAVED);
    assert.equal(parseFields(null), null);
    assert.equal(parseFields("Is this a lamp?"), null);
    assert.equal(parseFields({ ...SAVED, prompt: 3 }), null);
    assert.equal(parseFields({ ...SAVED, expectedAnswer: undefined }), null);
    assert.equal(parseFields({ ...SAVED, isPublished: "true" }), null);
  });

  test("takes the word shown as an id or as none, and nothing else", () => {
    const shown = { ...SAVED, shownWordId: LAMP };
    assert.deepEqual(parseFields(shown), shown);
    assert.equal(parseFields({ ...SAVED, shownWordId: "lamp" }), null);
    assert.equal(parseFields({ ...SAVED, shownWordId: "" }), null);
    assert.equal(parseFields({ ...SAVED, shownWordId: 7 }), null);
    // Left out is not none: a write built from it would keep the old word.
    const without: Record<string, unknown> = { ...SAVED };
    delete without.shownWordId;
    assert.equal(parseFields(without), null);
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

  test("a question a student holds says how to retire it, on a delete", () => {
    assert.match(
      deleteError("violates foreign key constraint", "23503"),
      /desmarque Publicada/,
    );
  });

  test("a foreign key refusal anywhere else is not about deleting", () => {
    // Adding to a point removed in another tab is 23503 as well.
    assert.equal(
      questionError("violates foreign key constraint", "23503"),
      "violates foreign key constraint",
    );
  });

  test("a delete still hears the refusals every write shares", () => {
    assert.equal(deleteError("anything", "QS001"), CHANGED_ELSEWHERE);
    assert.match(
      deleteError("question 1ce2 not found", "P0001"),
      /não existe mais/,
    );
  });

  test("a word that is gone says which field", () => {
    const refused =
      'insert or update on table "questions" violates foreign key constraint "questions_shown_vocabulary_item_id_fkey"';
    assert.match(questionError(refused, "23503"), /Palavra mostrada/);
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

describe("failureMessage", () => {
  test("an error is its message", () => {
    assert.equal(failureMessage(new Error("fetch failed")), "fetch failed");
    assert.equal(failureMessage("plain"), "plain");
  });

  test("the redirect of an ended session is said in words", () => {
    // What next/navigation's redirect() throws: an error carrying a digest.
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    assert.equal(failureMessage(redirect), SESSION_ENDED);
  });
});

describe("the forms open in a point", () => {
  test("opening a second form leaves the first one open", () => {
    const open = opened(opened(new Set(), "a"), "b");
    assert.deepEqual([...open], ["a", "b"]);
  });

  test("closing one leaves the others", () => {
    const open = closed(new Set(["a", "b"]), "a");
    assert.deepEqual([...open], ["b"]);
  });

  test("neither changes the set it was given", () => {
    const before: ReadonlySet<string> = new Set(["a"]);
    opened(before, "b");
    closed(before, "a");
    assert.deepEqual([...before], ["a"]);
  });
});
