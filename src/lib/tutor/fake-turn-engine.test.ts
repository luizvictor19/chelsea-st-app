import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FakeTurnEngine } from "./fake-turn-engine.ts";

const WORDS = [
  { term: "book", imageUrl: "https://example.test/book.png" },
  { term: "pen", imageUrl: "https://example.test/pen.png" },
];

const silence = { speak: async () => {}, thinkingMs: 0 };
const audio = new Blob([]);

describe("FakeTurnEngine", () => {
  test("opens by presenting the first word and asking", async () => {
    const turn = await new FakeTurnEngine(WORDS, silence).start();
    assert.equal(turn.word?.term, "book");
    assert.equal(turn.question, "What is this?");
    assert.equal(turn.verdict, null);
    assert.equal(turn.finished, false);
  });

  /*
   * The whole script over two words: right moves on, a correction repeats the
   * same word, and the right answer on the last word ends the session.
   */
  test("alternates right and corrected, moving on only when right", async () => {
    const engine = new FakeTurnEngine(WORDS, silence);
    await engine.start();

    const first = await engine.respond(audio);
    assert.equal(first.verdict, "correct");
    assert.equal(first.word?.term, "pen");

    const second = await engine.respond(audio);
    assert.equal(second.verdict, "corrected");
    assert.equal(second.word?.term, "pen");
    assert.match(second.speech, /It's a pen/);

    const third = await engine.respond(audio);
    assert.equal(third.verdict, "correct");
    assert.equal(third.word, null);
    assert.equal(third.question, null);
    assert.equal(third.finished, true);
  });

  test("play hands the speech to the voice it was given", async () => {
    const said: string[] = [];
    const engine = new FakeTurnEngine(WORDS, {
      speak: async (text) => {
        said.push(text);
      },
      thinkingMs: 0,
    });
    const turn = await engine.start();
    await turn.play();
    assert.deepEqual(said, [turn.speech]);
  });

  test("refuses an empty word list", () => {
    assert.throws(() => new FakeTurnEngine([], silence));
  });
});
