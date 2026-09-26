// Relative, with the extension: notice-texts.test.ts runs under node, which
// resolves neither the @/ alias nor a missing extension.
import type {
  Representation,
  WordClass,
} from "../../../../lib/content/queries.ts";
import type { ImageStyle } from "../../../../lib/images/style.ts";

import { notices } from "../../notices.ts";

import type { BulkChange, WordOutcome } from "./bulk.ts";

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
  /**
   * The result of a long run, which stays until closed even when it is a
   * success: the run takes a minute or more, and the teacher is not looking
   * at the corner of the screen when it ends.
   */
  readonly stays?: true;
};

/** Into the teacher area's snackbar, which outlives any one panel. */
export function tell(notice: NoticeText) {
  notices.push(notice.kind, notice.text, { stays: notice.stays });
}

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
    return { ...success(`${lessonLabel(lesson)}: ${head}.`), stays: true };
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
  const text =
    fresh === 0
      ? `${lessonLabel(lesson)}: nenhum conjunto novo.`
      : fresh === 1
        ? `${lessonLabel(lesson)}: 1 sugestão de conjunto.`
        : `${lessonLabel(lesson)}: ${fresh} sugestões de conjunto.`;
  // A run of up to a minute, like Sugerir tipos; see NoticeText.stays.
  return { ...success(text), stays: true };
}

/**
 * The lesson's state, in its header: how many of its words carry a
 * suggestion, read from the server so it is right after every reload. Not a
 * notice. Zero is written out: a lesson nobody has suggested yet is where the
 * button matters most.
 */
export function suggestedCount(suggested: number): string {
  return suggested === 1 ? "1 sugerido" : `${suggested} sugeridos`;
}

/** "1 palavra", "3 palavras". */
function wordsCount(count: number): string {
  return count === 1 ? "1 palavra" : `${count} palavras`;
}

/** What a failed bulk write was, at the head of its notice. */
const NOT_WRITTEN: Record<BulkChange["kind"], string> = {
  accept: "Sugestão não aceita em",
  representation: "Tipo não gravado em",
  wordClass: "Classe não gravada em",
  style: "Estilo não gravado em",
};

/** The failures of a bulk action, with what did go through. */
function bulkFailed(
  head: string,
  failed: readonly { readonly term: string; readonly error: string }[],
  done: number,
  doneWord: { readonly one: string; readonly many: string },
): NoticeText {
  const terms = failed.map((item) => item.term).join(", ");
  const reasons = [...new Set(failed.map((item) => sentence(item.error)))];
  const rest =
    done === 0
      ? `Nenhuma outra foi ${doneWord.one}.`
      : done === 1
        ? `1 foi ${doneWord.one}.`
        : `${done} foram ${doneWord.many}.`;
  return error(
    `${head} ${wordsCount(failed.length)}: ${terms}. ${reasons.join(" ")} ${rest}`,
  );
}

/**
 * The one notice of a bulk write (Aceitar sugestão, Definir tipo, Classe,
 * Estilo), never one a word. A failure anywhere makes it an error that names
 * the words that failed and says how many went through, since nothing is
 * rolled back. Words that already held the value are counted apart, and so
 * are, for Aceitar sugestão, words with no suggestion; a zero is left out.
 */
export function bulkNotice(
  change: BulkChange,
  outcomes: readonly WordOutcome[],
  termOf: (id: string) => string,
): NoticeText {
  const written = outcomes.filter((o) => o.outcome === "written").length;
  const same = outcomes.filter(
    (o) => o.outcome === "skipped" && o.reason === "same",
  ).length;
  const none = outcomes.filter(
    (o) => o.outcome === "skipped" && o.reason === "no-suggestion",
  ).length;
  const failed = outcomes.flatMap((o) =>
    o.outcome === "failed" ? [{ term: termOf(o.id), error: o.error }] : [],
  );

  if (failed.length > 0) {
    return bulkFailed(
      NOT_WRITTEN[change.kind],
      failed,
      written,
      change.kind === "accept"
        ? { one: "aceita", many: "aceitas" }
        : { one: "gravada", many: "gravadas" },
    );
  }

  if (change.kind === "accept") {
    const parts = [
      written === 1 ? "1 sugestão aceita" : `${written} sugestões aceitas`,
      ...(none > 0 ? [`${none} sem sugestão`] : []),
      ...(same > 0 ? [same === 1 ? "1 já aceita" : `${same} já aceitas`] : []),
    ];
    return success(`${parts.join(", ")}.`);
  }

  const what =
    change.kind === "representation"
      ? `tipo alterado para ${labelFor(change.value).toLowerCase()}`
      : change.kind === "wordClass"
        ? `classe alterada para ${wordClassLabel(change.value).toLowerCase()}`
        : `estilo alterado para ${IMAGE_STYLE_LABELS[change.value].toLowerCase()}`;
  const already =
    same === 0 ? "" : same === 1 ? ", 1 já estava" : `, ${same} já estavam`;
  return success(`${wordsCount(written)}: ${what}${already}.`);
}

/**
 * The one notice of Gerar instrução for the selection. It stays until
 * closed, like the other long runs: nine instructions take a while and the
 * teacher is elsewhere when they end.
 */
export function subjectsNotice(counts: {
  readonly generated: number;
  readonly had: number;
  readonly noPicture: number;
  readonly failed: readonly { readonly term: string; readonly error: string }[];
}): NoticeText {
  if (counts.failed.length > 0) {
    return bulkFailed(
      "Instrução não gerada em",
      counts.failed,
      counts.generated,
      {
        one: "gerada",
        many: "geradas",
      },
    );
  }
  const parts = [
    counts.generated === 1
      ? "1 instrução gerada"
      : `${counts.generated} instruções geradas`,
    ...(counts.had > 0
      ? [counts.had === 1 ? "1 já tinha" : `${counts.had} já tinham`]
      : []),
    ...(counts.noPicture > 0
      ? [`${counts.noPicture} sem tipo que leve imagem`]
      : []),
  ];
  return { ...success(`${parts.join(", ")}.`), stays: true };
}
