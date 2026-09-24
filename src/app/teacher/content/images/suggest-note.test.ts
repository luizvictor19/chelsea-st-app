import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { restingNote, suggestNote } from "./suggest-note.ts";

describe("suggestNote", () => {
  /*
   * The batch in flight, not the words already done. The note is written
   * before the call goes out, so what it can honestly name is what is being
   * asked for, and that is also the more useful of the two: a run that stops
   * here stopped on these words.
   */
  test("names the batch it is waiting on", () => {
    assert.equal(
      suggestNote({ kind: "running", from: 11, to: 20, total: 60 }),
      "Sugerindo 11 a 20 de 60",
    );
    assert.equal(
      suggestNote({ kind: "running", from: 1, to: 10, total: 60 }),
      "Sugerindo 1 a 10 de 60",
    );
  });

  /* A last batch of one should not read "Sugerindo 60 a 60 de 60". */
  test("does not write a range when the batch is one word", () => {
    assert.equal(
      suggestNote({ kind: "running", from: 60, to: 60, total: 60 }),
      "Sugerindo 60 de 60",
    );
  });
});

describe("restingNote", () => {
  /*
   * What the screen says when nothing is running, which since 2026-09-20 is
   * most of the time: this sentence replaced the count that used to sit in
   * the lesson header, so it is the only place the state is written.
   */
  test("says how many of the lesson's words carry a suggestion", () => {
    assert.equal(restingNote(60, 0), "60 sugeridos");
    assert.equal(restingNote(58, 2), "58 sugeridos, 2 sem resposta");
  });

  /*
   * A zero is noise. "60 sugeridos, 0 recusados" makes the reader look for a
   * problem that is not there.
   */
  test("mentions refusals only when there were any", () => {
    assert.doesNotMatch(restingNote(60, 0), /sem resposta/u);
  });

  /*
   * The number the teacher needs when a word comes back with nothing. It is
   * sent minus suggested and not the parser's refusals: a word the model
   * leaves out of its reply is counted in neither of the parser's lists, and
   * before this sentence existed it was mentioned nowhere at all.
   */
  test("counts a word the model never answered for", () => {
    assert.equal(restingNote(9, 1), "9 sugeridos, 1 sem resposta");
    assert.equal(restingNote(50, 10), "50 sugeridos, 10 sem resposta");
  });

  test("counts one in the singular, on both halves", () => {
    assert.equal(restingNote(1, 1), "1 sugerido, 1 sem resposta");
  });

  /*
   * A lesson nobody has suggested yet is where the button matters most, and
   * an empty space there would read as a screen that had not loaded.
   */
  test("writes the zero out rather than saying nothing", () => {
    assert.equal(restingNote(0, 0), "0 sugeridos");
  });
});

describe("suggestNote, a run that stopped", () => {
  /*
   * The case the batching created. A run that stops partway leaves the lesson
   * half suggested, which is allowed — but silence there would leave the
   * teacher believing the lesson was done.
   */
  test("a run that stopped says how many never passed, and why", () => {
    assert.equal(
      suggestNote({
        kind: "stalled",
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
        covered: 10,
        total: 60,
        error: "motivo exato",
      }),
      /motivo exato$/u,
    );
  });
});
