/*
 * The whiteboard of the live lesson, as data: what was drawn, what undo takes
 * back, how the row is split between the card and the board, and which keys
 * are the board's. Nothing here touches the DOM.
 */

export type Ink = "black" | "red" | "blue";

/**
 * A point of the board, in CSS pixels from its top left corner. The board
 * has one scale, whatever its width and in full screen too: a narrower board
 * shows less of the same drawing, and what falls outside is kept.
 */
export type Point = readonly [x: number, y: number];

export type Stroke = {
  readonly kind: "stroke";
  readonly ink: Ink | "erase";
  readonly points: readonly Point[];
};

export type Text = {
  readonly kind: "text";
  readonly ink: Ink;
  /** The left end of the line, at the middle of its height. */
  readonly at: Point;
  readonly text: string;
};

/**
 * One thing the teacher did on the board. The eraser is a stroke like the
 * pen's, in the colour of the ground. Clearing is a mark too and not an empty
 * list, so undo brings back a board cleared by mistake. An edit is a mark for
 * the same reason: it names the text it rewrites by that text's place in the
 * list, which never changes because the list only grows at the end and
 * shrinks from the end. An edit to nothing removes the text. It carries where
 * the text is left as well as what it says, so a text moved and rewritten in
 * one turn at the field is one mark, and one step for undo.
 */
export type Mark =
  | Stroke
  | Text
  | { readonly kind: "clear" }
  | {
      readonly kind: "edit";
      readonly origin: number;
      readonly text: string;
      readonly at: Point;
    };

/** A text as it stands now, and where in the list it was first written. */
export type StandingText = Text & { readonly origin: number };

/**
 * The marks to paint: those made since the board was last cleared, each text
 * saying what its last edit left and standing where that edit left it. In
 * the order of painting it keeps the place where it was first written.
 */
export function standing(
  marks: readonly Mark[],
): readonly (Stroke | StandingText)[] {
  const cleared = marks.findLastIndex((mark) => mark.kind === "clear");
  const shown: (Stroke | StandingText)[] = [];
  for (let index = cleared + 1; index < marks.length; index++) {
    const mark = marks[index];
    if (mark.kind === "stroke") {
      shown.push(mark);
    } else if (mark.kind === "text") {
      shown.push({ ...mark, origin: index });
    } else if (mark.kind === "edit") {
      const place = shown.findIndex(
        (other) => other.kind === "text" && other.origin === mark.origin,
      );
      const edited = shown[place];
      if (edited === undefined || edited.kind !== "text") continue;
      if (mark.text === "") shown.splice(place, 1);
      else shown[place] = { ...edited, text: mark.text, at: mark.at };
    }
  }
  return shown;
}

/**
 * Rewrites a text that stands on the board, and moves it when a place is
 * given, both as one step for undo to take back. Left empty, the text is
 * removed. Left as it was and where it was, nothing is added, so undo is
 * never spent on an edit that changed nothing.
 */
export function editText(
  marks: readonly Mark[],
  origin: number,
  text: string,
  at?: Point,
): readonly Mark[] {
  const edited = standing(marks).find(
    (mark) => mark.kind === "text" && mark.origin === origin,
  );
  if (edited === undefined || edited.kind !== "text") return marks;
  const next = text.trim();
  const place = at ?? edited.at;
  return next === edited.text &&
    place[0] === edited.at[0] &&
    place[1] === edited.at[1]
    ? marks
    : [...marks, { kind: "edit", origin, text: next, at: place }];
}

/** The letter of the board, in CSS pixels, and the height of its line in em. */
export const LETTER = { size: 56, line: 1.2 } as const;

/**
 * The text under a point, the one painted last when two overlap, or null on
 * empty board. The width of a text is the canvas's to say, so it is asked for.
 */
export function textAt(
  shown: readonly (Stroke | StandingText)[],
  [x, y]: Point,
  widthOf: (text: string) => number,
): StandingText | null {
  const half = (LETTER.size * LETTER.line) / 2;
  for (const mark of shown.toReversed()) {
    if (mark.kind !== "text") continue;
    const [left, middle] = mark.at;
    if (
      x >= left &&
      x <= left + widthOf(mark.text) &&
      y >= middle - half &&
      y <= middle + half
    ) {
      return mark;
    }
  }
  return null;
}

/**
 * The place nearest to this one where a text this wide is whole inside a
 * board of this size: where a text being dragged is left. A text wider than
 * the board, or a board lower than a line, keeps the beginning of the text
 * in view, at the left and the top edge.
 */
export function keepInView(
  [x, y]: Point,
  width: number,
  area: { readonly width: number; readonly height: number },
): Point {
  const half = (LETTER.size * LETTER.line) / 2;
  return [
    Math.max(Math.min(x, area.width - width), 0),
    Math.max(Math.min(y, area.height - half), half),
  ];
}

/*
 * The board shares the row with the card: the card, a handle to drag, the
 * board. A share is the part of the row's width the board takes. Each side
 * keeps at least a quarter of the row. NOT YET SEEN ON A SCREEN: the quarter
 * is the number asked for, to be moved by what turns out to be legible.
 */
export const SPLIT = { least: 0.25, most: 0.75, first: 0.5, handle: 16 };

// The padding and the border of the card, both sides, in CSS pixels: the
// part of its width that does not shrink with it.
const CARD_FRAME = 34;

export function clampShare(share: number): number {
  return Math.min(Math.max(share, SPLIT.least), SPLIT.most);
}

/** The share that puts the middle of the handle under the pointer. */
export function shareAt(
  row: { readonly left: number; readonly width: number },
  pointerX: number,
): number {
  if (row.width <= 0) return SPLIT.first;
  const board = row.left + row.width - pointerX - SPLIT.handle / 2;
  return clampShare(board / row.width);
}

/**
 * How much of its full width the inside of the card keeps, from 0 to 1, with
 * the board taking this share of a row this wide (null: the board is closed).
 * The words of the card are sized by the width of the screen, and are
 * multiplied by this to go on fitting the card as it narrows.
 */
export function cardScale(rowWidth: number, share: number | null): number {
  if (share === null || rowWidth <= CARD_FRAME) return 1;
  const card = rowWidth * (1 - share) - SPLIT.handle;
  return Math.max((card - CARD_FRAME) / (rowWidth - CARD_FRAME), 0);
}

/** Takes back the last thing done, a clearing included. */
export function undo(marks: readonly Mark[]): readonly Mark[] {
  return marks.slice(0, -1);
}

/** Clears the board. An empty board stays as it is, so undo is never spent on nothing. */
export function clearAll(marks: readonly Mark[]): readonly Mark[] {
  return standing(marks).length === 0 ? marks : [...marks, { kind: "clear" }];
}

export type BoardKey = "toggle" | "undo" | "pass";

/**
 * What a key means to the board, for a key pressed outside a text field (a
 * field keeps its own keys, the Q included). Q opens and closes. With the
 * board open, Ctrl+Z undoes. Everything else passes on to the lesson, the
 * arrows and the space too: the card beside the board goes on being turned.
 */
export function boardKey(
  event: {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly altKey: boolean;
  },
  open: boolean,
): BoardKey {
  const key = event.key.toLowerCase();
  if (event.altKey) return "pass";
  if (event.ctrlKey || event.metaKey) {
    return open && key === "z" ? "undo" : "pass";
  }
  return key === "q" ? "toggle" : "pass";
}
