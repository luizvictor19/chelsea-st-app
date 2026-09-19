import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  REPRESENTATION_KINDS,
  WORD_CLASSES,
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
   * because neither kind described a body held in a position.
   */
  test("separates pose from action by rest against activity", () => {
    const { system } = buildSuggestionPrompt(WORDS);
    assert.match(system, /rest against activity/iu);
    assert.match(system, /at rest/iu);
    assert.match(system, /doing something/iu);
    assert.match(system, /freeze the drawing/iu);
  });

  /*
   * The arrow used to be the criterion, and that was wrong: smile is an
   * action and has no direction to point at. It may still be mentioned as a
   * drawing consequence, but never as what tells the two kinds apart.
   */
  test("does not make the arrow the criterion", () => {
    const { system } = buildSuggestionPrompt(WORDS);
    assert.doesNotMatch(system, /arrow is what separates/iu);
    assert.match(system, /not what tells the two apart/iu);
    assert.match(system, /smile is an action with no arrow/iu);
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
      { id: IDS[0], kind: "photo", wordClass: null },
      { id: IDS[1], kind: "figure", wordClass: null },
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
    assert.deepEqual(suggestions, [
      { id: IDS[1], kind: "none", wordClass: null },
    ]);
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
    assert.deepEqual(suggestions, [
      { id: IDS[0], kind: "photo", wordClass: null },
    ]);
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
    assert.deepEqual(suggestions, [
      { id: IDS[0], kind: "photo", wordClass: null },
    ]);
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
    assert.deepEqual(suggestions, [
      { id: IDS[0], kind: "photo", wordClass: null },
    ]);
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
    assert.deepEqual(suggestions, [
      { id: IDS[1], kind: "action", wordClass: null },
    ]);
    assert.equal(rejected, 3);
  });
});

describe("overwriteWarning", () => {
  const both = {
    suggestedRepresentation: "photo",
    wordClass: "noun",
  } as const;
  const onlyClass = {
    suggestedRepresentation: null,
    wordClass: "verb",
  } as const;
  const onlyKind = {
    suggestedRepresentation: "figure",
    wordClass: null,
  } as const;
  const without = { suggestedRepresentation: null, wordClass: null } as const;

  test("nothing stored means no confirmation, so the click goes straight through", () => {
    assert.deepEqual(overwriteWarning([]), { confirm: false, suggested: 0 });
    assert.deepEqual(overwriteWarning([without, without]), {
      confirm: false,
      suggested: 0,
    });
  });

  test("one suggested word is enough to ask first", () => {
    assert.deepEqual(overwriteWarning([without, both, without]), {
      confirm: true,
      suggested: 1,
    });
  });

  /*
   * One number and not two. The pass writes both columns in the same
   * request, so a word carries both or neither from any run onwards, and
   * counting them apart only ever described lesson 1, which was suggested
   * before the class column existed. A word with either still counts once.
   */
  test("counts a word once, whichever of the two columns it carries", () => {
    assert.deepEqual(overwriteWarning([onlyClass, onlyKind, both, without]), {
      confirm: true,
      suggested: 3,
    });
  });
});

describe("the word class half of the answer", () => {
  test("names every class the database has, so the model sees the whole enum", () => {
    const { system } = buildSuggestionPrompt(WORDS);
    for (const wordClass of WORD_CLASSES) {
      assert.ok(system.includes(wordClass), `missing ${wordClass}`);
    }
  });

  /*
   * The three rules a term of more than one word is decided by. They are the
   * part that gets argued about, so the prompt has to state them.
   */
  test("states the rules for a term of more than one word", () => {
    const { system } = buildSuggestionPrompt(WORDS);
    assert.match(system, /keeps its particle is verb/iu);
    assert.match(system, /prepositional locution is preposition/iu);
    assert.match(system, /phrase is only for a term with no single function/iu);
  });

  test("reads the class back", () => {
    const text = JSON.stringify({
      suggestions: [{ id: IDS[0], kind: "photo", class: "noun" }],
    });
    const { suggestions } = parseSuggestions(text, IDS);
    assert.deepEqual(suggestions, [
      { id: IDS[0], kind: "photo", wordClass: "noun" },
    ]);
  });

  /*
   * A class outside the enum is dropped on its own. Throwing away a good
   * representation suggestion because the model called something a particle
   * would cost the teacher more than the bad class does.
   */
  test("drops an unknown class without losing the kind", () => {
    const text = JSON.stringify({
      suggestions: [{ id: IDS[0], kind: "photo", class: "particle" }],
    });
    const { suggestions, rejected } = parseSuggestions(text, IDS);
    assert.deepEqual(suggestions, [
      { id: IDS[0], kind: "photo", wordClass: null },
    ]);
    assert.equal(rejected, 0);
  });

  test("an unknown kind still rejects the whole entry, class or no class", () => {
    const text = JSON.stringify({
      suggestions: [{ id: IDS[0], kind: "drawing", class: "noun" }],
    });
    const { suggestions, rejected } = parseSuggestions(text, IDS);
    assert.deepEqual(suggestions, []);
    assert.equal(rejected, 1);
  });
});
