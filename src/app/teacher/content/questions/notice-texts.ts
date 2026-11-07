// Relative, with the extension: notice-texts.test.ts runs under node, which
// resolves neither the @/ alias nor a missing extension.
import { notices } from "../../notices.ts";
import { leftOutList, type LeftOut } from "./publish-reviewed.ts";

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

/**
 * A scene made from a question's form. It is chosen in the form, and the
 * question shows it once the form is saved; a new scene has no picture yet,
 * so the notice says what is still owed.
 */
export function sceneCreated(point: number): NoticeText {
  return success(point, "cena criada e escolhida. Falta a imagem");
}

/** The description was a scene's already: that one is chosen instead. */
export function sceneFound(point: number): NoticeText {
  return success(point, "essa cena já existia e foi escolhida");
}

/**
 * What Sugerir perguntas brought (#231). The model is asked for a number it
 * cannot be held to (measured in #83), so fewer than asked is said with the
 * reason. `returned` is what the model wrote, `added` what became a card:
 * a draft equal to a card already on screen does not become a second one.
 */
export function questionsSuggested(
  point: number,
  counts: {
    readonly asked: number;
    readonly returned: number;
    readonly added: number;
  },
): NoticeText {
  const { asked, returned, added } = counts;
  if (returned === 0) {
    return success(point, "o modelo não sugeriu nenhuma pergunta");
  }
  if (added === 0) {
    return success(point, "as perguntas sugeridas já estavam nos cartões");
  }
  const parts = [
    returned < asked
      ? `${returned} de ${asked} perguntas sugeridas: o modelo não achou mais perguntas naturais`
      : returned === 1
        ? "1 pergunta sugerida"
        : `${returned} perguntas sugeridas`,
  ];
  const repeated = returned - added;
  if (repeated > 0) {
    parts.push(
      repeated === 1
        ? "1 já estava nos cartões"
        : `${repeated} já estavam nos cartões`,
    );
  }
  return success(point, parts.join(". "));
}

/**
 * What "Publicar revisadas" did (#232): how many went, which drafts stayed
 * and why, and the ones changed in another tab, which were not touched.
 */
export function draftsPublished(
  point: number,
  result: {
    readonly published: number;
    readonly changed: number;
    readonly left: readonly LeftOut[];
  },
): NoticeText {
  const parts = [
    result.published === 0
      ? "nenhuma pergunta publicada"
      : result.published === 1
        ? "1 pergunta publicada"
        : `${result.published} perguntas publicadas`,
  ];
  if (result.left.length > 0) {
    parts.push(`Ficaram como rascunho: ${leftOutList(result.left)}`);
  }
  if (result.changed > 0) {
    parts.push(
      result.changed === 1
        ? "1 mudou em outro lugar e não foi tocada. Recarregue a página"
        : `${result.changed} mudaram em outro lugar e não foram tocadas. Recarregue a página`,
    );
  }
  return {
    kind: result.changed > 0 ? "error" : "success",
    text: `${pointLabel(point)}: ${sentence(parts.join(". "))}`,
  };
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
