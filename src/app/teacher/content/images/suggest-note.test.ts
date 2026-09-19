import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { suggestNote } from "./suggest-note.ts";

describe("suggestNote", () => {
  test("counts the lesson out while it walks it", () => {
    assert.equal(
      suggestNote({ kind: "running", covered: 20, total: 60 }),
      "20 de 60",
    );
  });

  test("says what a finished run wrote", () => {
    assert.equal(
      suggestNote({ kind: "done", suggested: 60, rejected: 0 }),
      "60 sugeridas",
    );
    assert.equal(
      suggestNote({ kind: "done", suggested: 58, rejected: 2 }),
      "58 sugeridas, 2 recusadas",
    );
  });

  /*
   * A zero is noise. "60 sugeridas, 0 recusadas" makes the reader look for a
   * problem that is not there.
   */
  test("mentions refusals only when there were any", () => {
    assert.doesNotMatch(
      suggestNote({ kind: "done", suggested: 60, rejected: 0 }),
      /recusad/u,
    );
  });

  test("counts one in the singular, on both halves", () => {
    assert.equal(
      suggestNote({ kind: "done", suggested: 1, rejected: 1 }),
      "1 sugerida, 1 recusada",
    );
  });

  /*
   * The case the batching created. A run that stops partway leaves the lesson
   * half suggested, which is allowed — but silence there would leave the
   * teacher believing the lesson was done.
   */
  test("a run that stopped says how many never passed, and why", () => {
    assert.equal(
      suggestNote({
        kind: "stalled",
        suggested: 20,
        rejected: 0,
        covered: 20,
        total: 60,
        error: "A resposta do servidor não chegou.",
      }),
      "Parou em 20 de 60: 40 não passaram. A resposta do servidor não chegou.",
    );
  });

  test("a run that stopped before the first batch says so too", () => {
    const said = suggestNote({
      kind: "stalled",
      suggested: 0,
      rejected: 0,
      covered: 0,
      total: 60,
      error: "sem chave",
    });
    assert.match(said, /Parou em 0 de 60/u);
    assert.match(said, /60 não passaram/u);
  });

  test("one word left over is singular", () => {
    assert.match(
      suggestNote({
        kind: "stalled",
        suggested: 59,
        rejected: 0,
        covered: 59,
        total: 60,
        error: "x",
      }),
      /1 não passou/u,
    );
  });

  /*
   * Never a negative. If the two numbers ever disagree the sentence should
   * read as nothing left rather than as minus three words.
   */
  test("never counts backwards", () => {
    assert.match(
      suggestNote({
        kind: "stalled",
        suggested: 0,
        rejected: 0,
        covered: 70,
        total: 60,
        error: "x",
      }),
      /0 não passaram/u,
    );
  });

  test("always carries the reason it stopped", () => {
    assert.match(
      suggestNote({
        kind: "stalled",
        suggested: 1,
        rejected: 0,
        covered: 10,
        total: 60,
        error: "motivo exato",
      }),
      /motivo exato$/u,
    );
  });
});
