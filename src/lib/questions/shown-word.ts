import type { Representation } from "@/lib/content/queries";

// Relative, with the extension: a value import, so it survives to runtime,
// and the tests run under node, which resolves neither the @/ alias nor a
// missing extension.
import { isDrawableKind } from "../images/style.ts";

import type { LessonWord, SetRow } from "./point-words.ts";
import { comparePlaces, presentationPlaces, type Place } from "./presented.ts";

/**
 * The word a question shows: the one whose approved picture is the first
 * thing on the question's card in the live lesson (0028).
 *
 * The question holds the word and never the picture, so what is shown is
 * always the picture the word has now. That is decided here, in one place,
 * for the field that offers the words, the row that shows the choice and the
 * card of the lesson.
 */

/** A vocabulary item with what says whether it has a picture to show. */
export type PicturedWord = LessonWord & {
  readonly representation: Representation | null;
  readonly imageUrl: string | null;
};

/**
 * The approved picture of a word, or null when it has none to show.
 *
 * The same reading as "com-imagem" on the images screen: a kind that is
 * drawn, and a picture on the word. vocabulary_items.image_path is the
 * approved picture and nothing else (vocabulary_items_approved_pair holds it
 * to the approved attempt). Measured on 2026-10-02: 69 of the 283 words have
 * one, and none of the 69 is of a kind that is not drawn, so today the kind
 * removes no word. It is checked anyway, to agree with the word's own card.
 */
export function approvedPicture(word: {
  readonly representation: Representation | null;
  readonly imageUrl: string | null;
}): string | null {
  if (word.representation === null) return null;
  return isDrawableKind(word.representation) ? word.imageUrl : null;
}

/** A word the field offers, with the picture that makes it one. */
export type ShownWordOption = {
  readonly id: string;
  readonly term: string;
  readonly imageUrl: string;
};

/**
 * The words a question at `at` may show: presented at or before that point,
 * by the validator's own reading (presentationPlaces, so a contrast set
 * counts from its latest member), and with an approved picture.
 *
 * The latest point first, since a question is most often about what its own
 * point has just presented; inside a point, alphabetical in English, so the
 * list does not move with the machine it is rendered on.
 */
export function shownWordOptions(
  words: readonly PicturedWord[],
  rows: readonly SetRow[],
  at: Place,
): readonly ShownWordOption[] {
  const setOf = new Map(
    rows.map((row) => [row.vocabulary_item_id, row.set_id]),
  );
  const places = presentationPlaces(
    words.map((word) => ({
      term: word.term,
      place: word.place,
      setId: setOf.get(word.id) ?? null,
    })),
  );
  return words
    .flatMap((word, index) => {
      const imageUrl = approvedPicture(word);
      const place = places[index];
      return imageUrl === null || comparePlaces(place, at) > 0
        ? []
        : [{ id: word.id, term: word.term, imageUrl, place }];
    })
    .sort(
      (a, b) =>
        comparePlaces(b.place, a.place) || a.term.localeCompare(b.term, "en"),
    )
    .map(({ id, term, imageUrl }) => ({ id, term, imageUrl }));
}
