import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EDIT_KEPT,
  landSuggestion,
  normalizeSubject,
  openingSubject,
  storeSubject,
  storeUploadSubject,
  storeSuggestion,
  type SubjectDb,
} from "./subject-store.ts";

/**
 * vocabulary_items reduced to the one column, with the update filters
 * applied the way PostgREST applies them: every filter has to match, and a
 * row no filter matches is left alone.
 */
function table(rows: Record<string, string | null>) {
  const state = new Map(Object.entries(rows));
  const db: SubjectDb = (values) => {
    const filters: ((id: string) => boolean)[] = [];
    const filter = {
      eq(column: "id" | "image_subject", value: string) {
        filters.push((id) =>
          column === "id" ? id === value : state.get(id) === value,
        );
        return filter;
      },
      is() {
        filters.push((id) => state.get(id) === null);
        return filter;
      },
      async select() {
        const hit = [...state.keys()].filter((id) =>
          filters.every((match) => match(id)),
        );
        for (const id of hit) state.set(id, values.image_subject);
        return { data: hit.map((id) => ({ id })), error: null };
      },
    };
    return filter;
  };
  return { db, state };
}

/** Opening a word as the page does: its row, read again. */
function reopen(state: Map<string, string | null>, id: string): string {
  return openingSubject({ imageSubject: state.get(id) ?? null });
}

describe("a suggestion never lands on another word", () => {
  test("it is stored on the word that asked, with another word open", async () => {
    const { db, state } = table({ apple: null, pear: "a green pear" });

    // Asked on apple; the teacher is on pear by the time it answers.
    const outcome = await storeSuggestion(db, "apple", null, "a red apple");

    assert.equal(outcome, "stored");
    assert.equal(reopen(state, "apple"), "a red apple");
    assert.equal(reopen(state, "pear"), "a green pear");
  });

  test("a word whose column happens to match is still not touched", async () => {
    // Both words empty: an expected value of null matches both, so only the
    // id keeps the write on apple.
    const { db, state } = table({ apple: null, pear: null });

    await storeSuggestion(db, "apple", null, "a red apple");

    assert.equal(state.get("pear"), null);
  });
});

describe("a suggestion never writes over an edit made while it was on its way", () => {
  test("the column moved on, so nothing is written and the edit stays", async () => {
    const { db, state } = table({ apple: "an apple" });

    // Asked with "an apple" on screen; the teacher edits and leaves the
    // field before the model answers.
    await storeSubject(db, "apple", "a bitten apple");
    const outcome = await storeSuggestion(
      db,
      "apple",
      "an apple",
      "a red apple",
    );

    assert.equal(outcome, "kept");
    assert.equal(reopen(state, "apple"), "a bitten apple");
  });

  test("the screen keeps the edit and says so", () => {
    assert.deepEqual(
      landSuggestion("an apple", "a bitten apple", {
        stored: false,
        subject: "a red apple",
      }),
      { field: "a bitten apple", note: EDIT_KEPT },
    );
  });

  test("text typed and not yet saved is kept on screen as well", () => {
    assert.deepEqual(
      landSuggestion("an apple", "an apple, bitten", {
        stored: true,
        subject: "a red apple",
      }),
      { field: "an apple, bitten", note: EDIT_KEPT },
    );
  });

  test("with nothing edited, the suggestion fills the field", () => {
    assert.deepEqual(
      landSuggestion("an apple", "an apple", {
        stored: true,
        subject: "a red apple",
      }),
      { field: "a red apple", note: null },
    );
  });
});

describe("an edit survives a trip to another word", () => {
  test("the edited text, not the suggestion, is what the word opens on", async () => {
    const { db, state } = table({ apple: null, pear: null });

    await storeSuggestion(db, "apple", null, "a red apple");
    // Edited, then generated with: both store the same text.
    await storeSubject(db, "apple", "a red apple on a plate ");
    await storeSubject(db, "apple", "a red apple on a plate");
    reopen(state, "pear");

    assert.equal(reopen(state, "apple"), "a red apple on a plate");
  });

  test("an emptied field is stored as null, which the column accepts", async () => {
    const { db, state } = table({ apple: "a red apple" });

    await storeSubject(db, "apple", "   ");

    assert.equal(state.get("apple"), null);
    assert.equal(reopen(state, "apple"), "");
  });
});

describe("normalizeSubject", () => {
  test("trims, and has one way of saying nothing", () => {
    assert.equal(normalizeSubject("  a red apple "), "a red apple");
    assert.equal(normalizeSubject(""), null);
    assert.equal(normalizeSubject(" \t"), null);
  });
});

describe("an upload's instruction", () => {
  test("becomes the word's, as a generation's does", async () => {
    const { db, state } = table({ apple: "an apple", pear: "a green pear" });

    const forAttempt = await storeUploadSubject(db, "apple", " a red apple ");

    assert.equal(forAttempt, "a red apple");
    assert.equal(reopen(state, "apple"), "a red apple");
    assert.equal(reopen(state, "pear"), "a green pear");
  });

  test("left empty, it says nothing and the word keeps its own", async () => {
    const { db, state } = table({ apple: "an apple" });

    const forAttempt = await storeUploadSubject(db, "apple", "  ");

    assert.equal(forAttempt, null);
    assert.equal(reopen(state, "apple"), "an apple");
  });
});
