import type { AnswerLanguage } from "@/lib/questions/queries";

/**
 * A question as the form holds it, and the rules the form follows. Pure, so
 * the rules are tested here and the component only draws them.
 */
export type QuestionFields = {
  readonly prompt: string;
  readonly expectedAnswer: string;
  readonly answerLanguage: AnswerLanguage;
  readonly isPublished: boolean;
};

/** What a new question starts as: English, and not yet published. */
export const EMPTY: QuestionFields = {
  prompt: "",
  expectedAnswer: "",
  answerLanguage: "en",
  isPublished: false,
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
  return null;
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
    a.isPublished !== b.isPublished
  );
}

/**
 * What the action receives, checked. A server action is reachable by anyone
 * who can send the POST, so its arguments are not what the types say until
 * they have been looked at.
 */
export function parseFields(value: unknown): QuestionFields | null {
  if (typeof value !== "object" || value === null) return null;
  const { prompt, expectedAnswer, answerLanguage, isPublished } =
    value as Record<string, unknown>;
  if (typeof prompt !== "string" || typeof expectedAnswer !== "string") {
    return null;
  }
  if (!isAnswerLanguage(answerLanguage) || typeof isPublished !== "boolean") {
    return null;
  }
  return { prompt, expectedAnswer, answerLanguage, isPublished };
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
