/**
 * Asking a model which kind of picture a word needs, and reading the answer
 * back safely. Both halves are pure, so the prompt and the parsing can be
 * tested without spending anything.
 *
 * A suggestion is never a decision. What comes out of here is written to
 * suggested_representation and nowhere else; the teacher is the one who fills
 * in representation, and the gap between the two columns is how the quality of
 * these suggestions gets measured.
 */

import type { Database } from "@/lib/supabase/types";

type Representation = Database["public"]["Enums"]["representation_kind"];

export const SUGGESTION_KINDS = [
  "photo",
  "symbol",
  "figure",
  "action",
  "none",
] as const satisfies readonly Representation[];

export type Suggestion = {
  readonly id: string;
  readonly kind: Representation;
};

/**
 * The five kinds come from docs/spec-imagens.md, so the model is asked the
 * same question the teacher answers. The boundary rules underneath them were
 * decided on 2026-09-19, from the pairs the book actually puts next to each
 * other: a named person against a bare title, a country against a
 * nationality. The word "json" has to appear for DeepSeek to accept
 * response_format json_object, and the example below is what the docs ask for
 * as well.
 */
const SYSTEM = `You sort English vocabulary words by the kind of picture each one needs.

The five kinds:
- photo: a concrete object, a living thing, or a named person, where one image is enough. Examples: apple, dog, table, Jack, Mr Brown.
- action: a verb or a gesture, shown as a person doing it. Examples: run, point, sit.
- figure: something drawn as a simple diagram rather than photographed. A spatial or quantity relation, a place on a map, or a colour as one filled shape. Examples: in, on, under, many, big, England, London, red.
- symbol: the word is the character itself. Examples: six, question mark, first.
- none: grammatical or functional, with nothing to draw. Examples: a, the, is, this, yes, Mr, English.

The pairs that are easy to confuse:
- A person's name is photo, because the book shows that person: Jack, Mr Brown, Mrs Smith. A title on its own is none: Mr, Mrs, Miss.
- A country or a city is figure, drawn as a map: England, Brazil, London.
- A nationality or a language is none: English, Brazilian, French.
- A colour is figure, drawn as one filled shape: red, blue, green.

Answer with json only, in exactly this shape:
{"suggestions": [{"id": "the id you were given", "kind": "photo|symbol|figure|action|none"}]}

Give one entry for every word you were sent, using the id exactly as it was given to you. No prose, no explanation.`;

/** The system and user halves of one classification request. */
export function buildSuggestionPrompt(
  words: readonly { readonly id: string; readonly term: string }[],
): { system: string; user: string } {
  if (words.length === 0) {
    throw new Error("A suggestion request needs at least one word");
  }
  const lines = words.map((word) => `${word.id}\t${word.term}`).join("\n");
  return {
    system: SYSTEM,
    user: `Sort these ${words.length} words. One per line, as id then a tab then the word:\n\n${lines}`,
  };
}

function isRepresentation(value: unknown): value is Representation {
  return (
    typeof value === "string" &&
    (SUGGESTION_KINDS as readonly string[]).includes(value)
  );
}

/**
 * A model's answer is untrusted input. Everything that is not a known id
 * paired with a known kind is counted and dropped, rather than written to a
 * column and discovered later: a bad enum value would be refused by Postgres
 * anyway, but a plausible id for the wrong word would not.
 *
 * Takes the ids that were sent, because "an id outside the list" cannot be
 * recognised without the list.
 */
export function parseSuggestions(
  text: string,
  sentIds: readonly string[],
): { suggestions: readonly Suggestion[]; rejected: number } {
  // json_object mode should make this unnecessary, but a fenced block is the
  // most common way a model ignores that, and unwrapping costs one line.
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");

  let body: unknown;
  try {
    body = JSON.parse(unfenced);
  } catch {
    return { suggestions: [], rejected: 0 };
  }

  const raw =
    typeof body === "object" && body !== null
      ? (body as { suggestions?: unknown }).suggestions
      : null;
  if (!Array.isArray(raw)) return { suggestions: [], rejected: 0 };

  const allowed = new Set(sentIds);
  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];
  let rejected = 0;

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      rejected += 1;
      continue;
    }
    const { id, kind } = entry as { id?: unknown; kind?: unknown };
    // A repeated id is dropped rather than allowed to overwrite: two answers
    // for one word means the model lost track, and the second is not better.
    if (
      typeof id !== "string" ||
      !allowed.has(id) ||
      seen.has(id) ||
      !isRepresentation(kind)
    ) {
      rejected += 1;
      continue;
    }
    seen.add(id);
    suggestions.push({ id, kind });
  }

  return { suggestions, rejected };
}
