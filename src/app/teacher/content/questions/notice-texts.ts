// Relative, with the extension: notice-texts.test.ts runs under node, which
// resolves neither the @/ alias nor a missing extension.
import { notices } from "../../notices.ts";

/**
 * Every sentence the questions screen puts in the teacher area's snackbar,
 * in the format the images screen set: what the notice is about comes first,
 * because the teacher may be three points down the page by the time it
 * arrives. Here that is the point, then the question by its number in the
 * point: "Ponto 4: pergunta 2 salva."
 *
 * Short sentences, ending in a full stop, and no dash.
 */
export type NoticeText = {
  readonly kind: "success" | "error";
  readonly text: string;
};

/** Into the teacher area's snackbar, which outlives any one form. */
export function tell(notice: NoticeText) {
  notices.push(notice.kind, notice.text);
}

/** A message ends in a full stop unless it already ends a sentence. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** What the screen calls a point, in its headers and in its notices. */
export function pointLabel(point: number): string {
  return `Ponto ${point}`;
}

function success(point: number, what: string): NoticeText {
  return { kind: "success", text: `${pointLabel(point)}: ${sentence(what)}` };
}

/** `number` is the question's place in its point, counted from 1. */
export function questionAdded(point: number, number: number): NoticeText {
  return success(point, `pergunta ${number} acrescentada`);
}

export function questionSaved(point: number, number: number): NoticeText {
  return success(point, `pergunta ${number} salva`);
}

export function questionDeleted(point: number, number: number): NoticeText {
  return success(point, `pergunta ${number} apagada`);
}

/** An action on one question that answered with ok false. */
export function questionFailed(
  point: number,
  number: number,
  message: string,
): NoticeText {
  return {
    kind: "error",
    text: `${pointLabel(point)}, pergunta ${number}: ${sentence(message)}`,
  };
}

/** An action on the point itself: a new question, or the order. */
export function pointFailed(point: number, message: string): NoticeText {
  return { kind: "error", text: `${pointLabel(point)}: ${sentence(message)}` };
}
