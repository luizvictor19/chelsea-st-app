/*
 * The whiteboard of the live lesson, as data: what was drawn, what undo takes
 * back, where a point of the screen falls on the board, and which keys the
 * board keeps from the lesson. Nothing here touches the DOM.
 */

export type Ink = "black" | "red" | "blue";

/** A point of the board, in the board's own units (see BOARD). */
export type Point = readonly [x: number, y: number];

/**
 * One thing the teacher did on the board. The eraser is a stroke like the
 * pen's, in the colour of the ground. Clearing is a mark too and not an empty
 * list, so undo brings back a board cleared by mistake.
 */
export type Mark =
  | {
      readonly kind: "stroke";
      readonly ink: Ink | "erase";
      readonly points: readonly Point[];
    }
  | {
      readonly kind: "text";
      readonly ink: Ink;
      readonly at: Point;
      readonly text: string;
    }
  | { readonly kind: "clear" };

/** The marks to paint: those made since the board was last cleared. */
export function standing(marks: readonly Mark[]): readonly Mark[] {
  const cleared = marks.findLastIndex((mark) => mark.kind === "clear");
  return marks.slice(cleared + 1);
}

/** Takes back the last thing done, a clearing included. */
export function undo(marks: readonly Mark[]): readonly Mark[] {
  return marks.slice(0, -1);
}

/** Clears the board. An empty board stays as it is, so undo is never spent on nothing. */
export function clearAll(marks: readonly Mark[]): readonly Mark[] {
  return standing(marks).length === 0 ? marks : [...marks, { kind: "clear" }];
}

/*
 * The board is drawn in units of its own, 1600 by 900, and fitted whole and
 * centred into whatever area the screen gives it. One scale for both axes, so
 * the window and the full screen show the same drawing larger or smaller and
 * never stretched. The area outside the 16:9 middle can be drawn on as well,
 * but only the middle is sure to be on screen at every size.
 */
export const BOARD = { width: 1600, height: 900 } as const;

export type Size = { readonly width: number; readonly height: number };

export type Fit = {
  readonly scale: number;
  readonly left: number;
  readonly top: number;
};

/** How the board sits in an area of this many CSS pixels. */
export function fit(area: Size): Fit {
  const scale = Math.min(area.width / BOARD.width, area.height / BOARD.height);
  return {
    scale,
    left: (area.width - BOARD.width * scale) / 2,
    top: (area.height - BOARD.height * scale) / 2,
  };
}

/** A point of the area, in CSS pixels, as a point of the board. */
export function toBoard(area: Size, x: number, y: number): Point {
  const { scale, left, top } = fit(area);
  return [(x - left) / scale, (y - top) / scale];
}

export type BoardKey = "toggle" | "undo" | "swallow" | "pass";

/**
 * What a key means to the board, for a key pressed outside a text field (a
 * field keeps its own keys, the Q included). Q opens and minimises. With the
 * board open, Ctrl+Z undoes, and the arrows and the space are swallowed so
 * the lesson does not change card under the drawing. Everything else passes
 * on to the lesson.
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
  if (key === "q") return "toggle";
  if (open && (key === " " || key.startsWith("arrow"))) return "swallow";
  return "pass";
}
