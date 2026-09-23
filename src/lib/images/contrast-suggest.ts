/**
 * Asking a model which words of a lesson form contrast sets, and reading the
 * answer back safely. Pure, so the prompt and the parsing are tested without
 * spending anything, and shared with scripts/measure-contrast-suggestions.ts
 * so the screen asks exactly what was measured.
 *
 * A proposal is never a set. Nothing here writes, and the screen writes a set
 * only when the teacher accepts it, through save_contrast_set (0022). Sets are
 * declared by the teacher; the model only saves her the typing.
 *
 * Measured on 2026-09-22 against the 14 sets the teacher linked by hand in
 * lessons 1 and 2 of book 1, one call per lesson: 90% precision and 98%
 * recall by pair over three runs. Asking one point at a time was measured
 * too, and was worse; the numbers are at the top of the script.
 */

// A relative specifier with the extension, not the @/ alias: this module is
// imported by node:test and by a script, and node resolves neither.
import { compareWords } from "../content/word-order.ts";
import type { Database } from "../supabase/types.ts";

type Representation = Database["public"]["Enums"]["representation_kind"];

/** A word as the prompt needs it. */
export type CandidateWord = {
  readonly id: string;
  readonly term: string;
  readonly point: number | null;
  /** Null for a word whose kind nobody has decided yet. */
  readonly kind: Representation | null;
  readonly wordClass: string | null;
};

/*
 * The kinds that get no picture. A set exists to show its members' pictures
 * side by side, so a word of these kinds has nothing to put in one. symbol is
 * not here: no image is generated for it, but a numeral is shown as one, and
 * the teacher's sets include one to five and six to ten.
 */
const PICTURELESS: ReadonlySet<string> = new Set([
  "usage",
  "metalanguage",
  "none",
]);

function byBook(a: CandidateWord, b: CandidateWord): number {
  return compareWords(
    { lessonNumber: null, pointNumber: a.point, term: a.term },
    { lessonNumber: null, pointNumber: b.point, term: b.term },
  );
}

/**
 * The words of a lesson worth asking about, in book order: the ones with a
 * picture that are in no set yet.
 *
 * A word already in a set is left out rather than sent and filtered after,
 * so the model cannot spend a proposal on it, and a word with no decided kind
 * is left out because nobody knows yet whether it will have a picture.
 */
export function contrastCandidates(
  words: readonly CandidateWord[],
  inASet: ReadonlySet<string>,
): readonly CandidateWord[] {
  return words
    .filter(
      (word) =>
        word.kind !== null &&
        !PICTURELESS.has(word.kind) &&
        !inASet.has(word.id),
    )
    .sort(byBook);
}

/** What one call is asked about: a whole lesson, or one point of it. */
export type ContrastUnit = {
  readonly lesson: number;
  readonly point: number | null;
  readonly words: readonly CandidateWord[];
};

export type ContrastMode = "lesson" | "point";

/*
 * No word of the teacher's sets is in the prompt: the examples of what a set
 * is (hot and cold, the days of the week) and of what it is not (apple and
 * banana) come from outside lessons 1 and 2.
 *
 * Two things in it are choices that move the result. The kinds with no
 * picture are ruled out, because a set exists to show pictures side by side.
 * And per lesson the point is offered as a hint, not a rule: every set the
 * teacher made sits inside one point, but 0022 keeps that from being a rule
 * because later lessons carry families on. Per point the hint goes, since
 * every word in the call shares it.
 *
 * The lesson text is the one measured on 2026-09-22, batch
 * 2026-09-22T23:04:34.347Z, character for character. A change to it is a new
 * measurement, not an edit.
 */
function systemPrompt(mode: ContrastMode): string {
  const hint =
    mode === "lesson"
      ? "\n- Words first taught at the same point are more likely to form a set together. This is a hint, not a rule."
      : "";
  return `You help an English teacher prepare picture cards for a beginners' course.

A contrast set is a small group of words from the same lesson whose meanings are learnt by comparing them. Each word gets its own picture, and the pictures are shown side by side, so that the difference between them carries the meaning. A pair of opposites is a contrast set (hot, cold). So is a short series from one closed family where each member is understood against the others (the days of the week).

You are given the words of one ${mode}. Each line has an id, the word, the point of the book where it is first taught, the kind of picture it gets, and its word class, separated by tabs.

Rules:
- Only words that get a picture can be in a set. The kinds usage, metalanguage and none get no picture: never put them in a set.
- Every member of a set must contrast with the others along the same dimension. Sharing a topic or a word class is not enough: apple and banana are both fruit, and that is not a contrast.
- A set has two or more words. A word is in at most one set.
- Most words belong to no set. Leave them out rather than force them in.${hint}

Answer in json, and only in json, with this shape:
{"sets": [{"members": ["<id>", "<id>"], "reason": "<one short sentence>"}]}
List the members of each set in the order they should be shown. Use only ids from the list.`;
}

export function buildContrastPrompt(
  unit: ContrastUnit,
  mode: ContrastMode,
): { system: string; user: string } {
  const lines = unit.words
    .map((w) => [w.id, w.term, w.point, w.kind, w.wordClass].join("\t"))
    .join("\n");
  const where =
    unit.point === null
      ? `Lesson ${unit.lesson}`
      : `Lesson ${unit.lesson}, point ${unit.point}`;
  return {
    system: systemPrompt(mode),
    user: `${where}. Find the contrast sets among these ${unit.words.length} words:\n\n${lines}`,
  };
}

export type ProposedSet = {
  /** In the order the model gave, which is not to be trusted for showing. */
  readonly members: readonly string[];
  /** The model's one sentence, or empty when it gave none. */
  readonly reason: string;
};

export type ParsedContrast = {
  readonly sets: readonly ProposedSet[];
  /** Members that were not a sent id: outside the lesson, or already in a set. */
  readonly unknown: number;
  /** Members dropped because an earlier set, or the same one, already held the word. */
  readonly repeated: number;
  /** Proposals left with fewer than two members once cleaned. */
  readonly tooSmall: number;
  /** The answer was not the shape asked for, and nothing was read from it. */
  readonly unreadable: boolean;
};

const UNREADABLE: ParsedContrast = {
  sets: [],
  unknown: 0,
  repeated: 0,
  tooSmall: 0,
  unreadable: true,
};

/**
 * The model's answer is untrusted, as in parseSuggestions. Only ids that were
 * sent are kept, and the sent list already leaves out every word of another
 * lesson and every word in a set, so that one check refuses both. A word
 * named twice keeps its first place, and a proposal left with one member is
 * dropped. Everything dropped is counted; nothing is repaired by guessing.
 */
export function parseContrastSuggestions(
  text: string,
  sent: readonly CandidateWord[],
): ParsedContrast {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "");
  let body: unknown;
  try {
    body = JSON.parse(unfenced);
  } catch {
    return UNREADABLE;
  }
  const raw =
    typeof body === "object" && body !== null
      ? (body as { sets?: unknown }).sets
      : null;
  if (!Array.isArray(raw)) return UNREADABLE;

  const allowed = new Set(sent.map((word) => word.id));
  const placed = new Set<string>();
  const sets: ProposedSet[] = [];
  let unknown = 0;
  let repeated = 0;
  let tooSmall = 0;

  for (const entry of raw) {
    const { members, reason } =
      typeof entry === "object" && entry !== null
        ? (entry as { members?: unknown; reason?: unknown })
        : { members: null, reason: null };
    if (!Array.isArray(members)) {
      tooSmall += 1;
      continue;
    }
    const kept: string[] = [];
    for (const id of members) {
      if (typeof id !== "string" || !allowed.has(id)) {
        unknown += 1;
      } else if (placed.has(id) || kept.includes(id)) {
        repeated += 1;
      } else {
        kept.push(id);
      }
    }
    if (kept.length < 2) {
      tooSmall += 1;
      continue;
    }
    for (const id of kept) placed.add(id);
    sets.push({
      members: kept,
      reason: typeof reason === "string" ? reason.trim() : "",
    });
  }
  return { sets, unknown, repeated, tooSmall, unreadable: false };
}

/**
 * Members in book order, the one the screen shows a proposal in.
 *
 * Measured on 2026-09-22, the model's order is not a proposal: it listed the
 * colours alphabetically in all three runs, the order they were sent in, and
 * turned three of four pairs round in one run of lesson 2. The teacher sets
 * the order; this only gives her a start that follows the book.
 */
export function inBookOrder(
  members: readonly string[],
  words: readonly CandidateWord[],
): readonly string[] {
  const byId = new Map(words.map((word) => [word.id, word]));
  const placed = members.filter((id) => byId.has(id));
  const unplaced = members.filter((id) => !byId.has(id));
  return [
    ...placed
      .map((id) => byId.get(id) as CandidateWord)
      .sort(byBook)
      .map((word) => word.id),
    ...unplaced,
  ];
}
