import { comparePlaces, presentationPlaces, type Place } from "./presented.ts";

/**
 * The words each point presents, the way the lesson presents them: a contrast
 * set side by side and whole, at the point of its latest member, and every
 * other word at its own point.
 *
 * The places come from presentationPlaces, the same function the validator
 * reads, so the words a point is shown to present are exactly the words a
 * question at that point may use without a mark.
 */

/** A vocabulary item, as the questions screen reads it. */
export type LessonWord = {
  readonly id: string;
  readonly term: string;
  readonly place: Place;
};

/** One row of contrast_set_items, as read. */
export type SetRow = {
  readonly set_id: string;
  readonly vocabulary_item_id: string;
  readonly position: number;
};

/** Words shown together: a contrast set in its order, or one word alone. */
export type WordGroup = {
  /** Stable across renders: the set's id, or the word's. */
  readonly key: string;
  readonly terms: readonly string[];
  readonly isSet: boolean;
};

/** "1:4" for point 4 of book 1: the key wordsByPoint files a point under. */
export function placeKey(place: Place): string {
  return `${place.book}:${place.point}`;
}

/**
 * Every point's groups, keyed by placeKey. Inside a point the groups run in
 * the alphabetical order of their first term, in English, so the list does
 * not move with the machine it is rendered on.
 */
export function wordsByPoint(
  words: readonly LessonWord[],
  rows: readonly SetRow[],
): ReadonlyMap<string, readonly WordGroup[]> {
  const setOf = new Map(rows.map((row) => [row.vocabulary_item_id, row]));
  const places = presentationPlaces(
    words.map((word) => ({
      term: word.term,
      place: word.place,
      setId: setOf.get(word.id)?.set_id ?? null,
    })),
  );

  type Draft = {
    readonly key: string;
    readonly place: Place;
    readonly isSet: boolean;
    readonly members: { readonly term: string; readonly order: number }[];
  };
  const groups = new Map<string, Draft>();
  words.forEach((word, index) => {
    const row = setOf.get(word.id);
    const key = row?.set_id ?? word.id;
    const group = groups.get(key) ?? {
      key,
      place: places[index],
      isSet: row !== undefined,
      members: [],
    };
    group.members.push({ term: word.term, order: row?.position ?? 0 });
    groups.set(key, group);
  });

  const byPoint = new Map<string, WordGroup[]>();
  const ordered = [...groups.values()]
    .map((group) => ({
      key: group.key,
      place: group.place,
      isSet: group.isSet,
      terms: [...group.members]
        .sort((a, b) => a.order - b.order)
        .map((member) => member.term),
    }))
    .sort(
      (a, b) =>
        comparePlaces(a.place, b.place) ||
        a.terms[0].localeCompare(b.terms[0], "en"),
    );
  for (const { place, ...group } of ordered) {
    const list = byPoint.get(placeKey(place)) ?? [];
    list.push(group);
    byPoint.set(placeKey(place), list);
  }
  return byPoint;
}
