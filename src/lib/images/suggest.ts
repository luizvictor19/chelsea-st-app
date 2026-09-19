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

// A relative specifier, not the @/ alias: this module is imported by a
// node:test file, and node resolves neither tsconfig paths nor a missing
// extension.
import { Constants, type Database } from "../supabase/types.ts";

type Representation = Database["public"]["Enums"]["representation_kind"];

/**
 * The kinds, taken from the generated enum rather than written out again.
 * A hand kept copy of an enum is a list that goes stale in silence: the
 * database grows a value, the parser keeps refusing it, and nothing says so.
 */
export const REPRESENTATION_KINDS: readonly Representation[] =
  Constants.public.Enums.representation_kind;

type WordClass = Database["public"]["Enums"]["word_class"];

export const WORD_CLASSES: readonly WordClass[] =
  Constants.public.Enums.word_class;

export type Suggestion = {
  readonly id: string;
  readonly kind: Representation;
  /** Null when the model gave none, or gave one outside the enum. */
  readonly wordClass: WordClass | null;
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

The six kinds:
- photo: a concrete object, a living thing, or a named person, where one image is enough. Examples: apple, dog, table, Jack, Mr Brown.
- pose: the body is at rest, and the position it is held in is what the word means. Examples: standing, sitting, lying.
- action: the person is doing something. Examples: sit down, stand up, open, close, smile, speak, write.
- figure: something drawn as a simple diagram rather than photographed, with no person in it. A spatial or quantity relation, a place on a map, or a colour as one filled shape. Examples: in, on, under, many, big, England, London, red.
- symbol: the word is the character itself. Examples: six, question mark, first.
- none: grammatical or functional, with nothing to draw. Examples: a, the, is, this, yes, Mr, English.

The pairs that are easy to confuse:
- A person's name is photo, because the book shows that person: Jack, Mr Brown, Mrs Smith. A title on its own is none: Mr, Mrs, Miss.
- A country or a city is figure, drawn as a map: England, Brazil, London.
- A nationality or a language is none: English, Brazilian, French.
- A colour is figure, drawn as one filled shape: red, blue, green.
- Pose against action is rest against activity. In pose the body is at rest and the position it is held in is the meaning of the word: standing, sitting, lying. In action the person is doing something: sit down, stand up, open, close, smile, speak, write. The practical test is to freeze the drawing: if it still says the word, it is pose; if it becomes a different word, it is action. An arrow is a consequence of drawing and not what tells the two apart: it goes in when the movement has a direction and stays out when it has none, which is why smile is an action with no arrow.

Answer with json only, in exactly this shape:
{"suggestions": [{"id": "the id you were given", "kind": "photo|pose|action|figure|symbol|none", "class": "noun|verb|adjective|adverb|pronoun|preposition|determiner|conjunction|numeral|question_word|interjection|phrase"}]}

The class is the part of speech, and it is a fact about the word rather than a judgement about the picture. For a term of more than one word:
- a verb that keeps its particle is verb: putting on, taking from.
- a prepositional locution is preposition: in front of.
- phrase is only for a term with no single function: what is (what's).

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
    (REPRESENTATION_KINDS as readonly string[]).includes(value)
  );
}

function isWordClass(value: unknown): value is WordClass {
  return (
    typeof value === "string" &&
    (WORD_CLASSES as readonly string[]).includes(value)
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
    const {
      id,
      kind,
      class: wordClass,
    } = entry as { id?: unknown; kind?: unknown; class?: unknown };
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
    /*
     * The class is validated but not required. An unrecognised one is worth
     * dropping on its own; throwing away a good representation suggestion
     * because the model called something a particle would cost the teacher
     * more than the bad class does.
     */
    suggestions.push({
      id,
      kind,
      wordClass: isWordClass(wordClass) ? wordClass : null,
    });
  }

  return { suggestions, rejected };
}

/**
 * Whether re-suggesting a lesson would throw away suggestions that are
 * already there, and how many.
 *
 * Takes the lesson's words rather than a number, because the count has to be
 * of the whole lesson and not of whatever the type filter happens to be
 * showing. Handing this function the list makes that the caller's obvious job.
 *
 * Counts both columns the pass writes, separately, because they are filled
 * at different times: a lesson can carry classes from an earlier run and no
 * suggestions, or the other way round. A decision is never at risk either
 * way; the pass writes suggested_representation and word_class and nothing
 * else.
 */
export function overwriteWarning(
  words: readonly {
    readonly suggestedRepresentation: Representation | null;
    readonly wordClass: WordClass | null;
  }[],
): { confirm: boolean; suggestions: number; classes: number } {
  const suggestions = words.filter(
    (word) => word.suggestedRepresentation !== null,
  ).length;
  const classes = words.filter((word) => word.wordClass !== null).length;
  // Either column being there is work the pass would replace, so either is
  // enough to ask first.
  return { confirm: suggestions > 0 || classes > 0, suggestions, classes };
}
