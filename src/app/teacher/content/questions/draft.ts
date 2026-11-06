import type { AnswerLanguage } from "@/lib/questions/queries";

// Relative, with the extension: a value import, and draft.test.ts runs under
// node, which resolves neither the @/ alias nor a missing extension.
import {
  NO_IMAGE,
  imageColumns,
  sameImage,
  type ImageChoice,
  type ImageColumns,
} from "../../../../lib/questions/question-image.ts";

/**
 * A question as the form holds it, and the rules the form follows. Pure, so
 * the rules are tested here and the component only draws them.
 */
export type QuestionFields = {
  readonly prompt: string;
  readonly expectedAnswer: string;
  readonly answerLanguage: AnswerLanguage;
  readonly isPublished: boolean;
  /** What the lesson shows with it: see question-image.ts. */
  readonly image: ImageChoice;
};

/** What a new question starts as: English, unpublished, no image decided. */
export const EMPTY: QuestionFields = {
  prompt: "",
  expectedAnswer: "",
  answerLanguage: "en",
  isPublished: false,
  image: NO_IMAGE,
};

/** The two languages an answer can be in, as the screen names them. */
export const ANSWER_LANGUAGES = [
  { value: "en", label: "Inglês" },
  { value: "pt", label: "Português" },
] as const satisfies readonly { value: AnswerLanguage; label: string }[];

export function isAnswerLanguage(value: unknown): value is AnswerLanguage {
  return ANSWER_LANGUAGES.some((language) => language.value === value);
}

/** The fields as they are stored: no space around either sentence. */
export function cleaned(fields: QuestionFields): QuestionFields {
  return {
    ...fields,
    prompt: fields.prompt.trim(),
    expectedAnswer: fields.expectedAnswer.trim(),
  };
}

/** Why the fields cannot be saved, or null when they can. */
export function refusal(fields: QuestionFields): string | null {
  if (fields.prompt.trim() === "") return "Escreva a pergunta";
  if (fields.expectedAnswer.trim() === "") return "Escreva a resposta esperada";
  if (fields.image.kind === "word" && fields.image.id === null) {
    return "Escolha a palavra mostrada";
  }
  if (fields.image.kind === "scene" && fields.image.id === null) {
    return "Escolha a cena";
  }
  return null;
}

/** The columns of questions an add or a save writes, the image's three among them. */
export type QuestionRow = {
  readonly prompt: string;
  readonly expected_answer: string;
  readonly answer_language: AnswerLanguage;
  readonly is_published: boolean;
} & ImageColumns;

/**
 * The fields as the row a write sets, or null for a word or a scene chosen
 * with no item. Every column, always: see imageColumns.
 */
export function questionRow(fields: QuestionFields): QuestionRow | null {
  const image = imageColumns(fields.image);
  if (image === null) return null;
  return {
    prompt: fields.prompt,
    expected_answer: fields.expectedAnswer,
    answer_language: fields.answerLanguage,
    is_published: fields.isPublished,
    ...image,
  };
}

/** One condition of the update's filter. */
export type Match =
  | {
      readonly column: keyof QuestionRow;
      readonly op: "eq";
      readonly value: string | boolean;
    }
  | {
      readonly column: keyof QuestionRow;
      readonly op: "is";
      readonly value: null;
    };

/**
 * What a save checks the row still holds before it writes: every column it
 * writes, as the form opened on them. Built from questionRow, so a column
 * the save starts writing is checked by the same change: one written and
 * not checked would let a save from an old view undo, in silence, an edit
 * made in another tab since.
 *
 * Null is matched with `is`: `eq` against null compares with = and matches
 * no row, which would refuse every edit of a question with that column
 * empty. Null for a `loaded` that names a kind with no item, which no row
 * can hold.
 */
export function stillLoaded(loaded: QuestionFields): readonly Match[] | null {
  const row = questionRow(loaded);
  if (row === null) return null;
  return (Object.keys(row) as (keyof QuestionRow)[]).map((column) => {
    const value = row[column];
    return value === null
      ? { column, op: "is", value: null }
      : { column, op: "eq", value };
  });
}

/**
 * Whether the form holds something a save would write. Compared as stored,
 * so a space typed at the end of a sentence is not an unsaved edit.
 */
export function isDirty(draft: QuestionFields, saved: QuestionFields): boolean {
  const a = cleaned(draft);
  const b = cleaned(saved);
  return (
    a.prompt !== b.prompt ||
    a.expectedAnswer !== b.expectedAnswer ||
    a.answerLanguage !== b.answerLanguage ||
    a.isPublished !== b.isPublished ||
    !sameImage(a.image, b.image)
  );
}

/**
 * The approved picture of a word or a scene, or null when it has none: as
 * the screen read it, or as an action reads it from the row. A lookup and
 * not a list, so the rule below needs no more of either than this.
 */
export type PictureOf = (kind: "word" | "scene", id: string) => string | null;

/**
 * Why these fields cannot be saved published, or null when they can.
 *
 * Robin needs a picture for every question a student practises, so a
 * question is only published showing a word or a scene with an approved
 * picture, or acted out, where the teacher is the scene. Unpublished, it is
 * a draft and is saved whatever it shows. The screen and the actions both
 * ask this, with the same `pictureOf` reading (approvedPicture for a word,
 * the image_path of a scene in use), so they refuse the same saves with the
 * same sentence. Not held by the database: a picture can still leave a word
 * or a scene after the question is published, and the list says so.
 */
export function publishRefusal(
  fields: QuestionFields,
  pictureOf: PictureOf,
): string | null {
  if (!fields.isPublished) return null;
  const { image } = fields;
  if (image.kind === "acted") return null;
  if (image.kind === "none") {
    return "Para publicar, escolha a imagem (Palavra ou Cena) ou marque Encenar. Sem Publicada, a pergunta é salva como rascunho";
  }
  if (image.id !== null && pictureOf(image.kind, image.id) !== null) {
    return null;
  }
  return image.kind === "word"
    ? "A palavra escolhida não tem imagem aprovada. Para publicar, escolha outra com imagem ou marque Encenar. Sem Publicada, a pergunta é salva como rascunho"
    : "A cena escolhida ainda não tem imagem aprovada. Para publicar, faça e aprove a imagem pelo link Fazer a imagem em Imagens, logo acima, ou marque Encenar. Sem Publicada, a pergunta é salva como rascunho";
}

const ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Shaped like the uuid the column holds. Whether it exists, the database says. */
function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

/**
 * What the action receives, checked. A server action is reachable by anyone
 * who can send the POST, so its arguments are not what the types say until
 * they have been looked at.
 */
export function parseFields(value: unknown): QuestionFields | null {
  if (typeof value !== "object" || value === null) return null;
  const { prompt, expectedAnswer, answerLanguage, isPublished, image } =
    value as Record<string, unknown>;
  if (typeof prompt !== "string" || typeof expectedAnswer !== "string") {
    return null;
  }
  if (!isAnswerLanguage(answerLanguage) || typeof isPublished !== "boolean") {
    return null;
  }
  const choice = parseImage(image);
  if (choice === null) return null;
  return { prompt, expectedAnswer, answerLanguage, isPublished, image: choice };
}

/**
 * One of the four kinds, rebuilt from its parts so nothing else rides along.
 * A missing image is refused, not read as "keep what the row had": the write
 * always sets all three columns (imageColumns), and the check before it
 * compares all three.
 */
function parseImage(value: unknown): ImageChoice | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, id } = value as Record<string, unknown>;
  if (kind === "none") return NO_IMAGE;
  if (kind === "acted") return { kind: "acted" };
  if (kind !== "word" && kind !== "scene") return null;
  // An id or null, and nothing in between: undefined is not "no item".
  if (id !== null && !isId(id)) return null;
  return { kind, id };
}

/**
 * The SQLSTATE reorder_questions raises when the list it is given is not
 * exactly the point's questions (0027): the screen loaded before another tab
 * added or removed one.
 */
export const STALE_ORDER_CODE = "QS001";

/** A second row at a position another holds: questions_point_id_position_key. */
const UNIQUE_VIOLATION = "23505";

/** assignment_items and attempts hold a question with restrict (0001). */
const FOREIGN_KEY_VIOLATION = "23503";

/** The reference from a question to the word it shows (0028). */
const SHOWN_WORD_KEY = "questions_shown_vocabulary_item_id_fkey";

/** The reference from a question to the scene it shows (0030). */
const SCENE_KEY = "questions_scene_id_fkey";

/** Both checks below raise check_violation. */
const CHECK_VIOLATION = "23514";

/** questions_scene_in_use's message (0034): the scene was excluded. */
const ARCHIVED_SCENE = /scene .* is archived and cannot be shown/;

/** At most one of word, scene and acted out (0030). */
const ONE_IMAGE = "questions_one_image";

export const CHANGED_ELSEWHERE =
  "As perguntas deste ponto mudaram em outro lugar depois que a página carregou, e nada foi gravado. Recarregue a página";

export const EDITED_ELSEWHERE =
  "Esta pergunta foi alterada ou apagada em outro lugar depois que a página carregou, e nada foi gravado. O que você escreveu continua aqui: copie antes de recarregar a página";

/**
 * The database's refusals, as sentences the teacher can act on. Anything not
 * recognised is passed through: an unknown reason shown raw beats one
 * guessed at.
 */
export function questionError(message: string, code?: string): string {
  if (code === STALE_ORDER_CODE || code === UNIQUE_VIOLATION) {
    return CHANGED_ELSEWHERE;
  }
  if (code === FOREIGN_KEY_VIOLATION && message.includes(SHOWN_WORD_KEY)) {
    return "A palavra escolhida em Imagem da pergunta não existe mais, e nada foi gravado. Recarregue a página";
  }
  if (code === FOREIGN_KEY_VIOLATION && message.includes(SCENE_KEY)) {
    return "A cena escolhida não existe mais, e nada foi gravado. Recarregue a página";
  }
  if (code === CHECK_VIOLATION && ARCHIVED_SCENE.test(message)) {
    return "A cena escolhida foi excluída na tela de imagens, e nada foi gravado. Escolha outra cena";
  }
  if (code === CHECK_VIOLATION && message.includes(ONE_IMAGE)) {
    return "Uma pergunta mostra só uma imagem: a palavra, a cena ou encenar. Nada foi gravado. Recarregue a página";
  }
  if (/question .* not found/.test(message)) {
    return "Esta pergunta não existe mais. Recarregue a página";
  }
  return message;
}

/**
 * The refusals of a delete: the shared ones, and the foreign key.
 *
 * Only here, because only on a delete does 23503 mean a student holds the
 * question. Adding to a point that was removed in another tab is 23503 too,
 * and that one has nothing to do with deleting.
 */
export function deleteError(message: string, code?: string): string {
  if (code === FOREIGN_KEY_VIOLATION) {
    return "Esta pergunta já foi passada a uma aluna e não pode ser apagada. Para tirá-la de uso, edite e desmarque Publicada";
  }
  return questionError(message, code);
}

export const SESSION_ENDED =
  "A sua sessão terminou e nada foi gravado. Entre de novo em outra aba e repita aqui: o que você escreveu continua nesta tela";

/**
 * Whatever an action threw, as a sentence.
 *
 * requireTeacher redirects to the login when the session has ended, and a
 * redirect is a throw: caught with everything else, it reached the snackbar
 * as "NEXT_REDIRECT". It is caught on purpose all the same. Letting it
 * through would navigate away from a form with a draft in it, so it is said
 * in words and the draft stays. Next marks the error with a digest that
 * opens with that name.
 */
export function failureMessage(cause: unknown): string {
  const digest =
    typeof cause === "object" && cause !== null && "digest" in cause
      ? cause.digest
      : undefined;
  if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
    return SESSION_ENDED;
  }
  return cause instanceof Error ? cause.message : String(cause);
}

/*
 * The edit forms open in a point, by question. A set and not one id: with
 * one, opening the form of a second question closed the first and took its
 * unsaved draft with it, without a word. Any number stay open, and a form
 * only closes by its own button or its own save.
 */

export function opened(
  open: ReadonlySet<string>,
  id: string,
): ReadonlySet<string> {
  return new Set([...open, id]);
}

export function closed(
  open: ReadonlySet<string>,
  id: string,
): ReadonlySet<string> {
  return new Set([...open].filter((other) => other !== id));
}
