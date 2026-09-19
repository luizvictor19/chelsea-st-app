import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  REPRESENTATION_KINDS,
  buildSuggestionPrompt,
  overwriteWarning,
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
    for (const kind of REPRESENTATION_KINDS) {
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

  /*
   * The caller now sends a whole lesson, decided words included, so the
   * prompt has to carry all of them rather than a sample. Nothing here knows
   * which were decided: this function is handed a list and asks about the
   * list, and that is the property worth holding.
   */
  test("asks about the whole list it was given, however long", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `id-${index}`,
      term: `word-${index}`,
    }));
    const { user } = buildSuggestionPrompt(many);
    for (const word of many) {
      assert.ok(user.includes(word.id), `missing ${word.id}`);
    }
    assert.ok(user.includes("40"), "the prompt should say how many words");
  });

  /*
   * The four boundaries the book keeps putting next to each other, pinned
   * here because they were got wrong once. These assert the rule is stated,
   * not that the model obeys it: whether it obeys is what the measurement in
   * docs/spec-imagens.md is for.
   */
  test("states the boundary between a person's name and a bare title", () => {
    const { system } = buildSuggestionPrompt(WORDS);
    assert.match(system, /Mr Brown/u);
    assert.match(system, /title on its own is none/iu);
  });

  test("states that places are figures and nationalities are not", () => {
    const { system } = buildSuggestionPrompt(WORDS);
    assert.match(system, /country or a city is figure/iu);
    assert.match(system, /nationality or a language is none/iu);
  });

  /*
   * The boundary the sixth kind exists for. Pose came out of the blind
   * measurement of lesson 2, where the only two misses were sitting and
   * standing: decided Figure, suggested Action, and both readings defensible
   * because neither kind described a person held in a position.
   */
  test("states that the arrow is what separates pose from action", () => {
    const { system } = buildSuggestionPrompt(WORDS);
    assert.match(system, /Pose is still and action is moving/iu);
    assert.match(system, /arrow is what separates them/iu);
    assert.match(system, /sitting from sit down/iu);
  });

  test("states that a colour is a figure", () => {
    const { system } = buildSuggestionPrompt(WORDS);
    assert.match(system, /colour is figure/iu);
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
  /*
   * Sending the whole lesson makes the list longer, which is exactly when a
   * model starts inventing plausible ids. The guard does not loosen because
   * the caller got more generous.
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

describe("overwriteWarning", () => {
  const withSuggestion = { suggestedRepresentation: "photo" } as const;
  const without = { suggestedRepresentation: null } as const;

  test("no suggestions stored means no confirmation, so the click goes straight through", () => {
    assert.deepEqual(overwriteWarning([]), { confirm: false, existing: 0 });
    assert.deepEqual(overwriteWarning([without, without]), {
      confirm: false,
      existing: 0,
    });
  });

  test("one stored suggestion is enough to ask first", () => {
    assert.deepEqual(overwriteWarning([without, withSuggestion, without]), {
      confirm: true,
      existing: 1,
    });
  });

  test("counts every stored suggestion, which is the number the teacher is shown", () => {
    const words = [withSuggestion, withSuggestion, without, withSuggestion];
    assert.deepEqual(overwriteWarning(words), { confirm: true, existing: 3 });
  });
});
