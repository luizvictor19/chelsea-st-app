import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TEXT_PRICES } from "../text/cost.ts";

import {
  CONTRAST_MODEL,
  CONTRAST_SCHEMA,
  parseContrastSuggestions,
} from "./contrast-suggest.ts";
import { SCENE_SUBJECT_SCHEMA } from "./scene-subject.ts";
import { SUBJECT_MODEL, SUBJECT_SCHEMA, parseSubject } from "./subject.ts";
import {
  REPRESENTATION_KINDS,
  SUGGESTION_MODEL,
  SUGGESTION_SCHEMA,
  WORD_CLASSES,
  parseSuggestions,
} from "./suggest.ts";

/**
 * The four answers a Claude call is held to (#225). The API compiles the
 * schema and refuses the request when it uses what structured outputs do not
 * support, and it does so only when the button is pressed: these tests are
 * where that refusal is met first, without spending anything.
 */

const SCHEMAS = {
  suggestion: SUGGESTION_SCHEMA,
  contrast: CONTRAST_SCHEMA,
  subject: SUBJECT_SCHEMA,
  scene: SCENE_SUBJECT_SCHEMA,
} as const;

/** Keywords structured outputs refuse or ignore, so none is ever written. */
const UNSUPPORTED = [
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "pattern",
  "format",
];

type Node = Record<string, unknown>;

/** Every object and array node of a schema, the root included. */
function nodes(schema: Node): Node[] {
  const found: Node[] = [schema];
  const properties = schema.properties as Record<string, Node> | undefined;
  for (const child of Object.values(properties ?? {})) {
    found.push(...nodes(child));
  }
  const items = schema.items as Node | undefined;
  if (items !== undefined) found.push(...nodes(items));
  return found;
}

describe("the answer schemas", () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    test(`${name}: every object closes and requires all its properties`, () => {
      const objects = nodes(schema).filter((node) => node.type === "object");
      assert.ok(objects.length > 0);
      for (const node of objects) {
        assert.equal(node.additionalProperties, false);
        assert.deepEqual(
          [...(node.required as string[])].sort(),
          Object.keys(node.properties as Node).sort(),
        );
      }
    });

    test(`${name}: uses nothing structured outputs refuse`, () => {
      for (const node of nodes(schema)) {
        for (const keyword of UNSUPPORTED) {
          assert.equal(Object.hasOwn(node, keyword), false, keyword);
        }
      }
    });
  }

  test("the kind and the class are the generated enums, in their order", () => {
    const entry = (
      SUGGESTION_SCHEMA.properties as {
        suggestions: { items: { properties: Record<string, Node> } };
      }
    ).suggestions.items.properties;
    assert.deepEqual(entry.kind?.enum, [...REPRESENTATION_KINDS]);
    assert.deepEqual(entry.class?.enum, [...WORD_CLASSES]);
    assert.deepEqual(entry.id, { type: "string" });
  });

  test("the scene's answer is the word's answer", () => {
    assert.equal(SCENE_SUBJECT_SCHEMA, SUBJECT_SCHEMA);
  });

  test("every model the suggestions call has a price, so the log line costs it", () => {
    for (const model of [SUGGESTION_MODEL, CONTRAST_MODEL, SUBJECT_MODEL]) {
      assert.ok(Object.hasOwn(TEXT_PRICES, model), model);
    }
  });
});

describe("an answer in the schema's shape reads whole", () => {
  test("kind and class", () => {
    const text = JSON.stringify({
      suggestions: [
        { id: "w1", kind: "photo", class: "noun" },
        { id: "w2", kind: "usage", class: "question_word" },
      ],
    });
    assert.deepEqual(parseSuggestions(text, ["w1", "w2"]), {
      suggestions: [
        { id: "w1", kind: "photo", wordClass: "noun" },
        { id: "w2", kind: "usage", wordClass: "question_word" },
      ],
      rejected: 0,
    });
  });

  test("contrast sets", () => {
    const sent = ["a", "b", "c"].map((id) => ({
      id,
      term: id,
      point: 1,
      kind: "figure" as const,
      wordClass: null,
    }));
    const text = JSON.stringify({
      sets: [{ members: ["a", "b"], reason: "Opposites." }],
    });
    assert.deepEqual(parseContrastSuggestions(text, sent), {
      sets: [{ members: ["a", "b"], reason: "Opposites." }],
      unknown: 0,
      repeated: 0,
      tooSmall: 0,
      unreadable: false,
    });
  });

  test("a subject", () => {
    assert.equal(
      parseSubject(
        JSON.stringify({ subject: "a red apple seen from the side" }),
      ),
      "a red apple seen from the side",
    );
  });
});
