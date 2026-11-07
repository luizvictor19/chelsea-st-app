// Relative, with the extension: publish-reviewed.test.ts runs under node,
// which resolves neither the @/ alias nor a missing extension.
import {
  publishRefusal,
  refusal,
  type PictureOf,
  type QuestionFields,
} from "./draft.ts";

/**
 * "Publicar revisadas" of one point (#232, sub-issue of #67): the drafts that
 * can be published go at once, and the others stay drafts with the reason.
 *
 * The rule is publishRefusal's, the one the form and the actions already
 * follow, so a draft published here is one the form would also have let
 * through: a word or a scene with an approved picture, or acted out. The
 * screen sorts with the pictures it shows; the action sorts again with the
 * pictures it reads from the database, and that one decides.
 */

/** A draft of the point, as the screen loaded it. */
export type Draft = {
  readonly id: string;
  /** Its place in the point, counted from 1, as the list shows it. */
  readonly number: number;
  readonly fields: QuestionFields;
};

export type LeftOut = {
  readonly number: number;
  readonly reason: string;
};

export type Sorted = {
  readonly ready: readonly Draft[];
  readonly left: readonly LeftOut[];
};

/** Why a draft cannot be published, in a few words for a list. */
function shortReason(
  fields: QuestionFields,
  pictureOf: PictureOf,
): string | null {
  if (fields.prompt.trim() === "" || fields.expectedAnswer.trim() === "") {
    return "sem pergunta ou resposta";
  }
  // A word or a scene with no item is a form half filled, never a stored
  // row; said as a missing picture, which is what publishing would lack.
  if (refusal(fields) !== null) return shortPicture(fields);
  if (publishRefusal({ ...fields, isPublished: true }, pictureOf) === null) {
    return null;
  }
  return shortPicture(fields);
}

function shortPicture(fields: QuestionFields): string {
  switch (fields.image.kind) {
    case "word":
      return "a palavra não tem imagem aprovada";
    case "scene":
      return "a cena não tem imagem aprovada";
    default:
      return "sem imagem decidida";
  }
}

/**
 * The point's drafts, sorted into the ones that can be published and the
 * ones left out, in the point's order. A question already published is
 * neither: it is not a draft.
 */
export function sortDrafts(
  drafts: readonly Draft[],
  pictureOf: PictureOf,
): Sorted {
  const ready: Draft[] = [];
  const left: LeftOut[] = [];
  for (const draft of drafts) {
    if (draft.fields.isPublished) continue;
    const reason = shortReason(draft.fields, pictureOf);
    if (reason === null) ready.push(draft);
    else left.push({ number: draft.number, reason });
  }
  return { ready, left };
}

/** "2 (sem imagem decidida), 4 (a cena não tem imagem aprovada)". */
export function leftOutList(left: readonly LeftOut[]): string {
  return left.map((one) => `${one.number} (${one.reason})`).join(", ");
}
