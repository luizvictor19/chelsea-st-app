/**
 * What a question shows (0030): the picture of one word, one scene, acted out
 * by the teacher, or nothing decided yet. Three columns in the database, at
 * most one of them set (questions_one_image); one value here, so "at most
 * one" holds by the shape of the type, and the columns only appear at the
 * two ends, the read and the write.
 *
 * A word or a scene may be chosen with its item not yet picked (`id` null):
 * that is a form half filled, never a stored state. Nothing reads it back
 * from a row, and imageColumns refuses to write it.
 */
export type ImageChoice =
  | { readonly kind: "none" }
  | { readonly kind: "word"; readonly id: string | null }
  | { readonly kind: "scene"; readonly id: string | null }
  | { readonly kind: "acted" };

export type ImageKind = ImageChoice["kind"];

/** The three columns of questions that hold the choice. */
export type ImageColumns = {
  readonly shown_vocabulary_item_id: string | null;
  readonly scene_id: string | null;
  readonly is_acted_out: boolean;
};

export const NO_IMAGE: ImageChoice = { kind: "none" };

/**
 * The choice a row holds. In the database's order, word, scene, acted out,
 * none: questions_one_image lets at most one be set, so the order only
 * matters for a row the check would have refused.
 */
export function imageOfColumns(row: ImageColumns): ImageChoice {
  if (row.shown_vocabulary_item_id !== null) {
    return { kind: "word", id: row.shown_vocabulary_item_id };
  }
  if (row.scene_id !== null) return { kind: "scene", id: row.scene_id };
  if (row.is_acted_out) return { kind: "acted" };
  return NO_IMAGE;
}

/**
 * The three columns a write sets, always all three, or null for a word or a
 * scene chosen with no item.
 *
 * All three because writing only the one that changed would leave the old
 * one set: a word swapped for a scene would hold both, and the database
 * refuses that (questions_one_image). The same three are what an edit is
 * checked against, so an edit made in another tab to any of them is seen.
 */
export function imageColumns(image: ImageChoice): ImageColumns | null {
  switch (image.kind) {
    case "none":
      return {
        shown_vocabulary_item_id: null,
        scene_id: null,
        is_acted_out: false,
      };
    case "acted":
      return {
        shown_vocabulary_item_id: null,
        scene_id: null,
        is_acted_out: true,
      };
    case "word":
      return image.id === null
        ? null
        : {
            shown_vocabulary_item_id: image.id,
            scene_id: null,
            is_acted_out: false,
          };
    case "scene":
      return image.id === null
        ? null
        : {
            shown_vocabulary_item_id: null,
            scene_id: image.id,
            is_acted_out: false,
          };
  }
}

/** Whether two choices are the same: the same kind, and the same item. */
export function sameImage(a: ImageChoice, b: ImageChoice): boolean {
  return a.kind === b.kind && itemOf(a) === itemOf(b);
}

/** The word or scene chosen, or null for the two kinds that have none. */
export function itemOf(image: ImageChoice): string | null {
  return image.kind === "word" || image.kind === "scene" ? image.id : null;
}
