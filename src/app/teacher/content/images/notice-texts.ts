// Relative, with the extension: notice-texts.test.ts runs under node, which
// resolves neither the @/ alias nor a missing extension.
import type {
  Representation,
  WordClass,
} from "../../../../lib/content/queries.ts";
import type { ImageStyle } from "../../../../lib/images/style.ts";

import { labelFor } from "./representation.ts";
import { wordClassLabel } from "./word-class.ts";

/**
 * Every sentence the image screen puts in the teacher area's snackbar.
 *
 * One place, so the formats hold still under tests and the screen never has
 * two phrasings of the same event. The rules they follow:
 * - a notice about a word starts with its term, because the teacher may be on
 *   another word by the time it arrives: "<termo>: <o que aconteceu>.";
 * - a notice about a lesson starts with "Lição N:";
 * - short sentences, ending in a full stop, and no dash.
 */

export type NoticeText = {
  readonly kind: "success" | "error";
  readonly text: string;
};

/** The style of a word's picture, as the screen names it. */
export const IMAGE_STYLE_LABELS = {
  flat: "Vetor chapado",
  realistic: "Realista",
} as const satisfies Record<ImageStyle, string>;

/** A message ends in a full stop unless it already ends a sentence. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function about(term: string, what: string): string {
  return `${term}: ${sentence(what)}`;
}

function success(text: string): NoticeText {
  return { kind: "success", text };
}

function error(text: string): NoticeText {
  return { kind: "error", text };
}

/** Any action on a word that answered with ok false. */
export function wordFailed(term: string, message: string): NoticeText {
  return error(about(term, message));
}

export function kindChanged(term: string, kind: Representation): NoticeText {
  return success(
    about(term, `tipo alterado para ${labelFor(kind).toLowerCase()}`),
  );
}

export function classChanged(
  term: string,
  wordClass: WordClass | null,
): NoticeText {
  if (wordClass === null) return success(about(term, "classe removida"));
  return success(
    about(
      term,
      `classe alterada para ${wordClassLabel(wordClass).toLowerCase()}`,
    ),
  );
}

export function styleChanged(term: string, style: ImageStyle): NoticeText {
  return success(
    about(
      term,
      `estilo alterado para ${IMAGE_STYLE_LABELS[style].toLowerCase()}`,
    ),
  );
}

export function referenceAttached(term: string): NoticeText {
  return success(about(term, "referência anexada"));
}

export function referenceRemoved(term: string): NoticeText {
  return success(about(term, "referência removida"));
}

/** An upload is never approved by sending it; see uploadFinishedImage. */
export function uploadSent(term: string): NoticeText {
  return success(about(term, "imagem enviada, falta aprovar"));
}

export function subjectGenerated(term: string): NoticeText {
  return success(about(term, "instrução gerada"));
}

export function imageApproved(term: string): NoticeText {
  return success(about(term, "imagem aprovada"));
}

/** "Descartar", as the bin and its dialog say it. */
export function imageDiscarded(term: string): NoticeText {
  return success(about(term, "imagem descartada"));
}

/** The instruction saves by itself, so only its failure is said. */
export function subjectNotSaved(term: string): NoticeText {
  return error(about(term, "a instrução não foi salva"));
}

/**
 * What a poll's list says about the generation it was asking after, or null
 * while it is still running. Finished elsewhere counts the same: the teacher
 * asked how it went, and it went.
 */
export function generationNotice(
  term: string,
  attemptId: string,
  attempts: readonly {
    readonly id: string;
    readonly status: string;
    readonly error: string | null;
  }[],
): NoticeText | null {
  const attempt = attempts.find((row) => row.id === attemptId);
  if (attempt === undefined) return null;
  if (attempt.status === "generated" || attempt.status === "approved") {
    return success(about(term, "imagem gerada"));
  }
  if (attempt.status === "failed") {
    return wordFailed(term, attempt.error ?? "a geração falhou");
  }
  return null;
}

/** A set's members, in the set's order. */
function members(terms: readonly string[]): string {
  return terms.join(", ");
}

export function setSaved(terms: readonly string[]): NoticeText {
  return success(`Conjunto salvo: ${members(terms)}.`);
}

export function setDissolved(terms: readonly string[]): NoticeText {
  return success(`Conjunto desfeito: ${members(terms)}.`);
}

/** A proposed set that could not be saved. It belongs to no single word. */
export function setFailed(
  terms: readonly string[],
  message: string,
): NoticeText {
  return error(`Conjunto ${members(terms)}: ${sentence(message)}`);
}

/** What the screen calls a lesson, in its header and in its notices. */
export function lessonLabel(lesson: number | null): string {
  return lesson === null ? "Fora de lição" : `Lição ${lesson}`;
}

/** Any lesson-wide action that answered with ok false. */
export function lessonFailed(
  lesson: number | null,
  message: string,
): NoticeText {
  return error(`${lessonLabel(lesson)}: ${sentence(message)}`);
}

/**
 * The end of a Sugerir tipos run, one notice for the whole lesson.
 *
 * Words sent and not answered make it an error, whatever else went well:
 * nothing is written for them, so they keep whatever suggestion they had
 * before, indistinguishable from one written a second ago, and this sentence
 * is the only place they are counted. Sent minus suggested, not the parser's
 * refusals, because a word the model leaves out of its reply is in neither of
 * the parser's lists.
 */
export function typesSuggested(
  lesson: number | null,
  suggested: number,
  unanswered: number,
): NoticeText {
  if (unanswered === 0) {
    const head =
      suggested === 1 ? "1 tipo sugerido" : `${suggested} tipos sugeridos`;
    return success(`${lessonLabel(lesson)}: ${head}.`);
  }
  const head = suggested === 1 ? "1 sugerido" : `${suggested} sugeridos`;
  return error(
    `${lessonLabel(lesson)}: ${head}, ${unanswered} sem resposta. Rode de novo.`,
  );
}

/**
 * A Sugerir tipos run that stopped partway. It says how many words it never
 * reached, which the lesson's state cannot say, since a word this run skipped
 * may well carry a suggestion from the last, and why it stopped.
 */
export function typesStalled(
  lesson: number | null,
  covered: number,
  total: number,
  message: string,
): NoticeText {
  // Never a negative: if the two numbers ever disagree, nothing is left.
  const left = Math.max(0, total - covered);
  const missed = left === 1 ? "1 não passou" : `${left} não passaram`;
  return error(
    `${lessonLabel(lesson)}: parou em ${covered} de ${total}, ${missed}. ${sentence(message)}`,
  );
}

/** What a Sugerir conjuntos click added to the screen. */
export function contrastSuggested(
  lesson: number | null,
  fresh: number,
): NoticeText {
  if (fresh === 0)
    return success(`${lessonLabel(lesson)}: nenhum conjunto novo.`);
  return success(
    fresh === 1
      ? `${lessonLabel(lesson)}: 1 sugestão de conjunto.`
      : `${lessonLabel(lesson)}: ${fresh} sugestões de conjunto.`,
  );
}
