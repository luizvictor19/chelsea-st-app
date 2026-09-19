import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SUGGESTION_KINDS,
  buildSuggestionPrompt,
  parseSuggestions,
} from "./suggest.ts";

const WORDS = [
  { id: "11111111-1111-1111-1111-111111111111", term: "apple" },
  { id: "22222222-2222-2222-2222-222222222222", term: "under" },
];
const IDS = WORDS.map((word) => word.id);

describe("buildSuggestionPrompt", () => {
  test("names every kind, so the model is told the whole enum", () => {
    const { system } = buildSuggestionPrompt(WORDS);
    for (const kind of SUGGESTION_KINDS) {
      assert.ok(system.includes(kind), `missing ${kind}`);
    }
  });

  /*
   * DeepSeek refuses response_format json_object unless the word appears in
   * the prompt, so this is a requirement of the API and not a style choice.
   */
  test("contains the word json, which the API requires", () => {
    const { system } = buildSuggestionPrompt(WORDS);
    assert.match(system, /json/iu);
  });

  test("sends every word with its id, and the ids are what come back", () => {
    const { user } = buildSuggestionPrompt(WORDS);
    for (const word of WORDS) {
      assert.ok(user.includes(word.id));
      assert.ok(user.includes(word.term));
    }
  });

  test("refuses an empty list instead of asking about nothing", () => {
    assert.throws(() => buildSuggestionPrompt([]), /at least one/);
  });
});

describe("parseSuggestions", () => {
  test("reads a well formed answer", () => {
    const text = JSON.stringify({
      suggestions: [
        { id: IDS[0], kind: "photo" },
        { id: IDS[1], kind: "figure" },
      ],
    });
    const { suggestions, rejected } = parseSuggestions(text, IDS);
    assert.equal(rejected, 0);
    assert.deepEqual(suggestions, [
      { id: IDS[0], kind: "photo" },
      { id: IDS[1], kind: "figure" },
    ]);
  });

  test("drops a kind that is not in the enum", () => {
    const text = JSON.stringify({
      suggestions: [
        { id: IDS[0], kind: "drawing" },
        { id: IDS[1], kind: "none" },
      ],
    });
    const { suggestions, rejected } = parseSuggestions(text, IDS);
    assert.deepEqual(suggestions, [{ id: IDS[1], kind: "none" }]);
    assert.equal(rejected, 1);
  });

  /*
   * The dangerous one. A kind outside the enum would be refused by Postgres
   * anyway; an id the model invented is a plausible uuid that would write a
   * suggestion onto the wrong word, or onto a word nobody asked about.
   */
  test("drops an id that was never sent", () => {
    const text = JSON.stringify({
      suggestions: [
        { id: "33333333-3333-3333-3333-333333333333", kind: "photo" },
        { id: IDS[0], kind: "photo" },
      ],
    });
    const { suggestions, rejected } = parseSuggestions(text, IDS);
    assert.deepEqual(suggestions, [{ id: IDS[0], kind: "photo" }]);
    assert.equal(rejected, 1);
  });

  test("keeps the first answer when one id comes back twice", () => {
    const text = JSON.stringify({
      suggestions: [
        { id: IDS[0], kind: "photo" },
        { id: IDS[0], kind: "none" },
      ],
    });
    const { suggestions, rejected } = parseSuggestions(text, IDS);
    assert.deepEqual(suggestions, [{ id: IDS[0], kind: "photo" }]);
    assert.equal(rejected, 1);
  });

  test("unwraps a fenced block, which is how json mode is usually ignored", () => {
    const inner = JSON.stringify({
      suggestions: [{ id: IDS[0], kind: "photo" }],
    });
    const { suggestions } = parseSuggestions(
      "```json\n" + inner + "\n```",
      IDS,
    );
    assert.deepEqual(suggestions, [{ id: IDS[0], kind: "photo" }]);
  });

  test("returns nothing rather than throwing on junk", () => {
    for (const junk of [
      "",
      "not json",
      "{}",
      '{"suggestions":"photo"}',
      "[]",
    ]) {
      const { suggestions, rejected } = parseSuggestions(junk, IDS);
      assert.deepEqual(suggestions, []);
      assert.equal(rejected, 0);
    }
  });

  test("counts malformed entries instead of hiding them", () => {
    const text = JSON.stringify({
      suggestions: [
        null,
        { id: IDS[0] },
        { kind: "photo" },
        { id: IDS[1], kind: "action" },
      ],
    });
    const { suggestions, rejected } = parseSuggestions(text, IDS);
    assert.deepEqual(suggestions, [{ id: IDS[1], kind: "action" }]);
    assert.equal(rejected, 3);
  });
});
