import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FakeTurnEngine, SILENT_BELOW_MS } from "./fake-turn-engine.ts";
import type { TurnEngine, TutorTurn } from "./turn-engine.ts";

const WORDS = [
  { term: "book", imageUrl: "https://example.test/book.png" },
  { term: "pen", imageUrl: "https://example.test/pen.png" },
];

const silence = { speak: async () => {}, thinkingMs: 0 };
const spoken = { audio: new Blob([]), durationMs: SILENT_BELOW_MS };
const silent = { audio: new Blob([]), durationMs: SILENT_BELOW_MS - 1 };

/** The tutor's turn, failing the test when the take was not heard. */
async function answer(engine: TurnEngine): Promise<TutorTurn> {
  const result = await engine.respond(spoken);
  if (result.kind !== "turn") assert.fail("the take was not heard");
  return result.turn;
}

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

    const first = await answer(engine);
    assert.equal(first.verdict, "correct");
    assert.equal(first.word?.term, "pen");

    const second = await answer(engine);
    assert.equal(second.verdict, "corrected");
    assert.equal(second.word?.term, "pen");
    assert.match(second.speech, /It's a pen/);

    const third = await answer(engine);
    assert.equal(third.verdict, "correct");
    assert.equal(third.word, null);
    assert.equal(third.question, null);
    assert.equal(third.finished, true);
  });

  /*
   * A hold with nothing said is neither an answer nor a mistake: the word
   * stays, and the right-then-corrected alternation is not advanced by it.
   * The boundary is shown from both sides.
   */
  test("a silent take is not heard and moves nothing", async () => {
    const engine = new FakeTurnEngine(WORDS, silence);
    await engine.start();

    assert.deepEqual(await engine.respond(silent), { kind: "not-heard" });
    assert.deepEqual(await engine.respond(silent), { kind: "not-heard" });

    const first = await answer(engine);
    assert.equal(first.verdict, "correct");
    assert.equal(first.word?.term, "pen");
  });

  test("a nudge gives the start of the sentence and moves nothing", async () => {
    const engine = new FakeTurnEngine(WORDS, silence);
    await engine.start();

    const nudge = await engine.nudge();
    assert.equal(nudge.lead, "It's a…");
    assert.equal(nudge.word?.term, "book");
    assert.equal(nudge.question, "What is this?");
    assert.equal(nudge.verdict, null);
    assert.equal(nudge.finished, false);

    const first = await answer(engine);
    assert.equal(first.verdict, "correct");
    assert.equal(first.word?.term, "pen");
    assert.equal(first.lead, null);
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
