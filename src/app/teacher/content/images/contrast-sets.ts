/**
 * Contrast sets, as the images screen handles them: words the teacher links
 * so the presentation shows their pictures side by side, since contrast does
 * not resolve inside one picture (migration 0022).
 *
 * Pure, so the rules the section follows are tested here and the component
 * only draws them. The database holds the same rules on its own (two or more
 * members, dense positions, one set per word); these exist so the teacher
 * hears about a refusal before the save rather than from it.
 */

/** A word as the section needs it: enough to name it and place it. */
export type SetWord = {
  readonly id: string;
  readonly term: string;
  readonly pointNumber: number | null;
  readonly lessonNumber: number | null;
};

/** A saved set, members in order of presentation. */
export type ContrastSet = {
  readonly id: string;
  readonly members: readonly SetWord[];
};

/** One row of contrast_set_items, as read. */
export type ContrastRow = {
  readonly set_id: string;
  readonly vocabulary_item_id: string;
  readonly position: number;
};

/**
 * The SQLSTATE save_contrast_set raises when the set in the database is no
 * longer the one the screen loaded (0022). Matched by code, not by message:
 * it is the one refusal the screen answers differently, by keeping the draft.
 */
export const STALE_SET_CODE = "CS001";

/** The smallest set the database accepts. */
export const MIN_MEMBERS = 2;

/**
 * Every saved set, keyed by each of its words, so the panel of any member
 * finds the set in one lookup. A row whose word is not in `words` is dropped
 * from the members rather than shown as a blank.
 */
export function setsByWord(
  rows: readonly ContrastRow[],
  words: readonly SetWord[],
): ReadonlyMap<string, ContrastSet> {
  const byId = new Map(words.map((word) => [word.id, word]));
  const grouped = new Map<string, ContrastRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.set_id) ?? [];
    list.push(row);
    grouped.set(row.set_id, list);
  }

  const result = new Map<string, ContrastSet>();
  for (const [id, list] of grouped) {
    const members = [...list]
      .sort((a, b) => a.position - b.position)
      .map((row) => byId.get(row.vocabulary_item_id))
      .filter((word): word is SetWord => word !== undefined);
    const set: ContrastSet = { id, members };
    for (const member of members) result.set(member.id, set);
  }
  return result;
}

/** Moves the member at `index` one place up (-1) or down (+1). */
export function moveMember(
  draft: readonly string[],
  index: number,
  delta: -1 | 1,
): readonly string[] {
  const target = index + delta;
  if (index < 0 || index >= draft.length) return draft;
  if (target < 0 || target >= draft.length) return draft;
  const next = [...draft];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Whether the draft differs from what is saved, order included. */
export function isChanged(
  draft: readonly string[],
  saved: readonly string[],
): boolean {
  return (
    draft.length !== saved.length ||
    draft.some((id, index) => id !== saved[index])
  );
}

/**
 * The words that can be added to the draft, best first.
 *
 * Without a search, only the words of the same point: every set measured
 * before 0022 had its first members there. With one, every word whose term
 * contains it, the same point first. Words already in the draft are left
 * out, and so is the open word itself, even once it is taken out of the
 * draft of a saved set: a word cannot be linked with itself, and putting it
 * back is Voltar ao salvo. Words that belong to another set are listed with that set, so the
 * teacher sees why they cannot be picked instead of not finding them.
 */
export function candidates(
  word: SetWord,
  draft: readonly string[],
  words: readonly SetWord[],
  sets: ReadonlyMap<string, ContrastSet>,
  ownSetId: string | null,
  search: string,
): readonly { word: SetWord; takenBy: ContrastSet | null }[] {
  const query = search.trim().toLowerCase();
  const inDraft = new Set(draft);
  const samePoint = (other: SetWord) =>
    other.pointNumber !== null && other.pointNumber === word.pointNumber;

  return words
    .filter((other) => other.id !== word.id && !inDraft.has(other.id))
    .filter((other) =>
      query === ""
        ? samePoint(other)
        : other.term.toLowerCase().includes(query),
    )
    .map((other, index) => ({ other, index }))
    .sort(
      (a, b) =>
        Number(samePoint(b.other)) - Number(samePoint(a.other)) ||
        a.index - b.index,
    )
    .map(({ other }) => {
      const set = sets.get(other.id) ?? null;
      return {
        word: other,
        takenBy: set !== null && set.id !== ownSetId ? set : null,
      };
    });
}

/**
 * The database's refusals, as sentences the teacher can act on. Anything not
 * recognised is passed through: an unknown reason shown raw beats one
 * guessed at.
 */
export function contrastError(message: string, code?: string): string {
  if (code === STALE_SET_CODE) {
    return "Este conjunto foi alterado em outro lugar depois que a página carregou, e nada foi gravado. Recarregue a página para ver como ele está agora. O seu rascunho continua aqui até você recarregar.";
  }
  const taken = /already in another contrast set: (.+)$/.exec(message);
  if (taken) return `Já está em outro conjunto: ${taken[1]}.`;
  if (message.includes("needs at least two")) {
    return "Um conjunto precisa de pelo menos duas palavras.";
  }
  if (/contrast set .* not found/.test(message)) {
    return "Este conjunto não existe mais. Recarregue a página.";
  }
  return message;
}

/**
 * The key the section mounts under: the open word and its saved set in
 * order, so a save lands as the new starting draft instead of leaving the
 * old one marked unsaved.
 *
 * Prefixed, because the section is a sibling of WordPanel, which is keyed by
 * the bare word id: with no saved set, an unprefixed key was that same id.
 */
export function sectionKey(
  wordId: string,
  rows: readonly ContrastRow[],
): string {
  const savedSet = rows.find(
    (row) => row.vocabulary_item_id === wordId,
  )?.set_id;
  return [
    "contrast",
    wordId,
    ...rows
      .filter((row) => row.set_id === savedSet)
      .sort((a, b) => a.position - b.position)
      .map((row) => row.vocabulary_item_id),
  ].join(":");
}

/** How a word in the list is marked as a member of a set. */
export type SetMark = {
  readonly setId: string;
  /** The set's number in book order, from 1. Keeps counting past the palette. */
  readonly ordinal: number;
  /** Index into the palette, from 0. */
  readonly colour: number;
};

/**
 * A colour and a number for every word in a set, by the order the sets first
 * appear in `order` (the book's order): the first set to appear takes colour
 * 0, the next colour 1, and past the last colour the cycle starts again, so
 * neighbouring sets never share one. Worked out on each render; nothing about
 * it is stored.
 */
export function setColours(
  order: readonly string[],
  rows: readonly ContrastRow[],
  paletteSize: number,
): ReadonlyMap<string, SetMark> {
  const setOf = new Map(
    rows.map((row) => [row.vocabulary_item_id, row.set_id]),
  );
  const bySet = new Map<string, SetMark>();
  const result = new Map<string, SetMark>();
  for (const id of order) {
    const setId = setOf.get(id);
    if (setId === undefined) continue;
    let mark = bySet.get(setId);
    if (mark === undefined) {
      mark = {
        setId,
        ordinal: bySet.size + 1,
        colour: bySet.size % paletteSize,
      };
      bySet.set(setId, mark);
    }
    result.set(id, mark);
  }
  return result;
}
