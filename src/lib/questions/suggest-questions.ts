/**
 * Asking a model for draft questions and expected answers for one point of
 * the book (#83), and reading the answer back. Pure: no database, no key, so
 * the prompt and the parsing are tested without spending anything, and the
 * "Sugerir perguntas" button of #67 imports exactly what was measured.
 *
 * A draft is never a question. Nothing here writes; the teacher approves
 * each pair before it is published, as every question is today.
 *
 * What the model is given is only what the database holds for the point: the
 * words presented before it and its new words, each with its class and what
 * the student can be shown, the contrast sets already presented, and the
 * active approved scenes. The questions already published and the lesson's
 * printed sentences are left out on purpose: points 4 to 52 and book 2 have
 * none, which is the case the button exists for, and a printed sentence in
 * the prompt would be copied.
 */

/** A vocabulary item, as the prompt needs it. */
export type SuggestWord = {
  readonly point: number;
  readonly term: string;
  readonly class: string | null;
  /** The decided representation, or null when nobody decided it yet. */
  readonly kind: string | null;
  /** Whether an approved picture exists. */
  readonly picture: boolean;
  /** What the picture shows, when somebody wrote it down. */
  readonly subject: string | null;
  /** The contrast set, or null. */
  readonly set: string | null;
};

/** An active, approved scene, and the first point it may be used at. */
export type SuggestScene = {
  readonly description: string;
  readonly point: number;
};

export type SuggestInput = {
  readonly book: number;
  readonly point: number;
  /** Any words of the book; the prompt keeps the ones up to the point. */
  readonly words: readonly SuggestWord[];
  readonly scenes: readonly SuggestScene[];
  /**
   * How many pairs to ask for; PAIRS_PER_POINT when left out. The teacher
   * chooses it on the button (Luiz, 2026-11-06). Asked for, not enforced:
   * structured outputs cannot hold an array to a length, so a caller may cut
   * what is over and cannot fill what is short.
   */
  readonly count?: number;
};

/**
 * Pairs asked for per point when the teacher does not say. Six, so the quick
 * measurement Luiz asked for on 2026-11-06 (2 points, 2 models, 1 pass)
 * lands at about 24 drafts.
 */
export const PAIRS_PER_POINT = 6;

/**
 * The model behind "Sugerir perguntas" (#67), chosen by Luiz on 2026-11-06
 * from the measurement of #83 (fixtures/questions/suggestions.jsonl, points 5
 * and 7 of book 1, read together in the conversation). Over batches "quick"
 * and "rules2", against Sonnet 5.5: no word the validator marks in 20 pairs
 * (Sonnet 5 in 24: "ball" from a picture's subject, "Where's" two points
 * early); US$ 0.00191 and 0.00206 for 2 calls (Sonnet 0.02749 and 0.02122);
 * median 6787 and 6549 ms, worst 10761 ms (Sonnet 4242 and 3716, worst
 * 10716). "Sonnet is too dear for this" (Luiz). The worst passes 10 s, so
 * the button is an action with a heartbeat. Called as the measurement called
 * it: effort low, SUGGEST_QUESTIONS_SCHEMA, no temperature, no cache.
 */
export const SUGGEST_QUESTIONS_MODEL = "claude-haiku-5-5";

/** The range a count may take; the button offers no other. */
export const MIN_PAIRS = 1;
export const MAX_PAIRS = 20;

/*
 * The rules, written before any answer was seen (plan on #83, 2026-11-06).
 * The examples use words that are in no measured point (dog, cup, black and
 * white as in SCENE_RULES): an example that is also an input hands the model
 * that answer.
 *
 * Changed after batch "quick" (points 5 and 7, Haiku and Sonnet, 22 pairs,
 * read with Luiz on 2026-11-06):
 * - rule 5: acted out is a rare fallback (Luiz), and the pictures in order
 *   of preference; 4 of 22 pairs were acted out and 14 asked a new scene;
 * - rule 1: "ball", read in the subject of the pictures of in, on and
 *   under, came back in 3 pairs as if it were a word of the course;
 * - rule 6: the one translation pair was a question answered in
 *   Portuguese ("Where is the book?", "Está na caixa.");
 * - rule 3: "the pen is on the table" came back uncontracted, where the
 *   book contracts is after a noun from point 4 on.
 *
 * After batch "rules2" (same points and models, 22 pairs): no pair acted
 * out, no "ball", every answer contracted, both translations the right way
 * round; but all 22 asked a new scene of their own. Rule 5 then let pairs
 * share a scene, as Luiz put it: keep the same scene when it is better,
 * change it when changing is better.
 *
 * After batch "share" (Haiku only, 10 pairs): two pairs shared a scene, 9
 * distinct new scenes, no mark; but "The box's under the table" came back,
 * which spoken English does not say. Rule 3 then kept is whole after a noun
 * that ends in an s, z, x, sh or ch sound. That sentence was not measured:
 * the first drafts the #67 button returns for a point with such a noun (box,
 * glass, watch) are the ones to read closely, and it is the first suspect if
 * a contraction comes back wrong.
 */
export const SUGGEST_QUESTIONS_RULES: readonly string[] = [
  `Use only the words in the two lists below: the words presented before this point and the new words of this point. No other word, however common, and no other name, and no other form of a word (no plural, no other verb form) unless it is listed. A word the student has not met breaks the lesson. What a picture shows is not a word the student has learnt: if the picture of "on" shows a cup on a table, "cup" is still not a listed word.`,
  `Each pair practises what is new at this point: a new word, or the new structure the new words make possible, such as a new question word or a new way to answer. Recycle the earlier words freely around it.`,
  `The expected answer is one full sentence with the grammar of the question and the contractions spoken English uses, after a noun too. For "Is the dog black?" it is "No, the dog isn't black; it's white", never "No" and never "White". For "Where's the dog?" it is "The dog's under the chair", not "The dog is under the chair". After a noun ending in an s, z, x, sh or ch sound, is stays whole: "The glass is on the table", never "The glass's on the table".`,
  `Do not force a question. A new word with no natural question in the words available, such as a number with nothing to count or a word about grammar, goes into pending and not into a pair.`,
  `Each pair says what the student sees, in this order of preference: a word whose picture exists (by its term, only from the words listed with a picture); an existing scene (by its description); a new scene (a short English description of what that picture would show); acted out (the teacher acts it). Acted out is a rare fallback, for a pair no picture can show: the student usually practises alone with a voice tutor and no teacher, so a pair that only works acted out is close to useless. Every new scene is a picture someone has to make, so reuse one when it serves: several pairs may share a scene when it shows what each of their answers affirms, and then their image is the same description, word for word. Change to another scene when a different picture practises the point better. The picture shows what the answer affirms. A word's picture shows only what its subject says: if the picture of "long" is a long pencil, it is not a long table.`,
  `At most one pair is a translation: answer_language "pt". Its prompt is an English sentence for the student to translate, never a question to answer in Portuguese, and its expected answer is that sentence in Portuguese, as a Brazilian says it. For "The dog's white." it is "O cachorro é branco."; for "Where's the dog?" there is no translation pair.`,
  `No two pairs ask the same thing about the same picture.`,
  `British spelling, as the course uses.`,
];

/** The answer's shape, enforced by the Claude provider. */
export const SUGGEST_QUESTIONS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          expected_answer: { type: "string" },
          answer_language: { type: "string", enum: ["en", "pt"] },
          image_kind: {
            type: "string",
            enum: ["word", "scene", "new_scene", "acted_out"],
          },
          image: { type: "string" },
          practises: { type: "string" },
        },
        required: [
          "prompt",
          "expected_answer",
          "answer_language",
          "image_kind",
          "image",
          "practises",
        ],
        additionalProperties: false,
      },
    },
    pending: { type: "array", items: { type: "string" } },
  },
  required: ["questions", "pending"],
  additionalProperties: false,
};

/** What the student can be shown for a word, in the prompt's words. */
export function shownAs(word: SuggestWord): string {
  if (word.kind === "metalanguage") return "a word about grammar, never asked";
  if (word.picture) {
    return word.subject === null || word.subject.trim() === ""
      ? "picture exists, what it shows is not recorded"
      : `picture: ${word.subject.trim()}`;
  }
  if (word.kind === "usage") return "no picture, used in sentences";
  return "no picture";
}

function line(word: SuggestWord): string {
  return `- ${word.term} · ${word.class ?? "class not decided"} · ${shownAs(word)}`;
}

/**
 * The contrast sets presented by the point: a set counts once its latest
 * member is presented, as the validator reads it (presentationPlaces).
 */
export function presentedSets(
  words: readonly SuggestWord[],
  point: number,
): readonly (readonly string[])[] {
  const members = new Map<string, SuggestWord[]>();
  for (const word of words) {
    if (word.set === null) continue;
    members.set(word.set, [...(members.get(word.set) ?? []), word]);
  }
  return [...members.values()]
    .filter((set) => set.every((word) => word.point <= point))
    .map((set) => set.map((word) => word.term));
}

export function buildSuggestQuestionsPrompt(input: SuggestInput): {
  system: string;
  user: string;
} {
  const count = input.count ?? PAIRS_PER_POINT;
  if (!Number.isInteger(count) || count < MIN_PAIRS || count > MAX_PAIRS) {
    throw new Error(
      `A count of ${count} pairs is outside ${MIN_PAIRS} to ${MAX_PAIRS}`,
    );
  }
  const before = input.words.filter((word) => word.point < input.point);
  const fresh = input.words.filter((word) => word.point === input.point);
  if (fresh.length === 0) {
    throw new Error(`Point ${input.point} has no new words`);
  }
  const sets = presentedSets(input.words, input.point);
  const scenes = input.scenes.filter((scene) => scene.point <= input.point);
  const rules = SUGGEST_QUESTIONS_RULES.map(
    (rule, index) => `${index + 1}. ${rule}`,
  ).join("\n");

  return {
    system: `You suggest practice questions for one point of an English course for Brazilian adults. The course teaches by question and answer: the teacher asks, and the student answers aloud in a full sentence.

Write ${count === 1 ? "one question and answer pair" : `${count} question and answer pairs`} for this point, or fewer when rule 4 leaves fewer natural ones. Answer with json only, in the shape the schema gives.

Rules:

${rules}`,
    user: `Point ${input.point} of book ${input.book}.

Words presented before this point (term · class · what the student can be shown):
${before.length === 0 ? "- none: this is the first point" : before.map(line).join("\n")}

New words of this point:
${fresh.map(line).join("\n")}

Shown side by side: ${sets.length === 0 ? "none" : sets.map((set) => set.join("/")).join("; ")}

Existing scenes:
${scenes.length === 0 ? "- none" : scenes.map((scene) => `- "${scene.description}"`).join("\n")}`,
  };
}

export type ImageKind = "word" | "scene" | "new_scene" | "acted_out";

export type DraftQuestion = {
  readonly prompt: string;
  readonly expectedAnswer: string;
  readonly answerLanguage: "en" | "pt";
  readonly imageKind: ImageKind;
  readonly image: string;
  readonly practises: string;
};

export type ParsedDrafts =
  | {
      readonly ok: true;
      readonly questions: readonly DraftQuestion[];
      readonly pending: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

const IMAGE_KINDS: readonly string[] = [
  "word",
  "scene",
  "new_scene",
  "acted_out",
];

/** The model's answer, untrusted: anything off the schema says why. */
export function parseDrafts(text: string): ParsedDrafts {
  let body: unknown;
  try {
    body = JSON.parse(text.trim());
  } catch {
    return { ok: false, reason: "not json" };
  }
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "not an object" };
  }
  const { questions, pending } = body as {
    questions?: unknown;
    pending?: unknown;
  };
  if (!Array.isArray(questions)) return { ok: false, reason: "no questions" };
  if (!Array.isArray(pending) || pending.some((p) => typeof p !== "string")) {
    return { ok: false, reason: "no pending list" };
  }

  const read: DraftQuestion[] = [];
  for (const [index, entry] of questions.entries()) {
    const e = (
      typeof entry === "object" && entry !== null ? entry : {}
    ) as Record<string, unknown>;
    const fields = ["prompt", "expected_answer", "image", "practises"];
    const missing = fields.find((name) => typeof e[name] !== "string");
    if (missing !== undefined) {
      return { ok: false, reason: `question ${index + 1}: no ${missing}` };
    }
    if (e.answer_language !== "en" && e.answer_language !== "pt") {
      return { ok: false, reason: `question ${index + 1}: answer_language` };
    }
    if (
      typeof e.image_kind !== "string" ||
      !IMAGE_KINDS.includes(e.image_kind)
    ) {
      return { ok: false, reason: `question ${index + 1}: image_kind` };
    }
    read.push({
      prompt: (e.prompt as string).trim(),
      expectedAnswer: (e.expected_answer as string).trim(),
      answerLanguage: e.answer_language,
      imageKind: e.image_kind as ImageKind,
      image: (e.image as string).trim(),
      practises: (e.practises as string).trim(),
    });
  }
  return { ok: true, questions: read, pending: pending as string[] };
}

/** Case, typographic apostrophes and outer quotes do not tell two apart. */
export function sameText(a: string, b: string): boolean {
  const key = (text: string) =>
    text
      .trim()
      .replace(/^["“]|["”]$/gu, "")
      .replace(/[‘’]/gu, "'")
      .replace(/\s+/gu, " ")
      .toLowerCase();
  return key(a) === key(b);
}

export type ResolvedImage<W, S> =
  | { readonly kind: "word"; readonly word: W }
  | { readonly kind: "scene"; readonly scene: S }
  | { readonly kind: "new_scene"; readonly description: string }
  | { readonly kind: "acted_out" }
  | { readonly kind: "invalid"; readonly reason: string };

/**
 * What a draft shows, against what exists at the point: the word with a
 * picture, the scene, a scene still to be made, or acted out. These map to
 * shown_vocabulary_item_id, scene_id and is_acted_out (0030) once #67 has
 * the ids; a new scene opens "Criar cena" filled in, and never generates.
 */
export function resolveImage<
  W extends { readonly term: string; readonly picture: boolean },
  S extends { readonly description: string },
>(
  draft: Pick<DraftQuestion, "imageKind" | "image">,
  words: readonly W[],
  scenes: readonly S[],
): ResolvedImage<W, S> {
  switch (draft.imageKind) {
    case "acted_out":
      return { kind: "acted_out" };
    case "new_scene":
      return draft.image === ""
        ? { kind: "invalid", reason: "new scene with no description" }
        : { kind: "new_scene", description: draft.image };
    case "scene": {
      const scene = scenes.find((s) => sameText(s.description, draft.image));
      return scene === undefined
        ? { kind: "invalid", reason: "no such scene" }
        : { kind: "scene", scene };
    }
    case "word": {
      const word = words.find((w) => sameText(w.term, draft.image));
      if (word === undefined)
        return { kind: "invalid", reason: "no such word" };
      return word.picture
        ? { kind: "word", word }
        : { kind: "invalid", reason: "word has no picture" };
    }
  }
}
