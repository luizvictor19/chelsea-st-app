import { TABLE_COLUMN_GAP, TABLE_LINE_TOLERANCE } from "./constants.ts";
import {
  cleanCell,
  serializeTable,
  type TableBlock,
  type TableLine,
} from "./grammar-table.ts";
import type { OcrWord } from "./types.ts";

/**
 * A table panel, read back as the grid it is printed as.
 *
 * The engine returns words, not a table: read in order and joined with spaces,
 * a conjugation grid becomes one line of prose with the columns welded to each
 * other and the rows welded end to end. Both boundaries are in the geometry the
 * engine already returns, and this is where they are read back out. It is the
 * same move as the vocabulary panels, where the column is what separates a term from
 * the next, not the space between two words.
 *
 * What comes out is the stored form of a grammar table, so the review screen
 * shows a grid of cells and the teacher corrects one instead of rebuilding all
 * of it.
 *
 * @param words as the engine returned them, in the enlarged crop's coordinates
 * @param scale how much the crop was enlarged before reading
 */
export function tableContent(words: readonly OcrWord[], scale = 1): string {
  const placed = words
    .map((word) => ({
      text: word.text.trim(),
      left: word.x / scale,
      right: (word.x + word.width) / scale,
      middle: (word.y + word.height / 2) / scale,
      height: word.height / scale,
    }))
    // The printed vertical rule is read as "|" often enough to matter, and "|"
    // is the column boundary of the stored form: kept, the rule would come back
    // as a boundary of ours, in the middle of a cell.
    .filter((word) => word.text !== "" && !isRule(word.text));

  if (placed.length === 0) {
    return "";
  }

  const tolerance =
    median(placed.map((word) => word.height)) * TABLE_LINE_TOLERANCE;
  const rows: TableLine[] = [];

  for (const line of groupLines(placed, tolerance)) {
    const ordered = [...line].sort((a, b) => a.left - b.left);
    const cells: string[][] = [[ordered[0].text]];
    let previousRight = ordered[0].right;
    for (const word of ordered.slice(1)) {
      if (word.left - previousRight >= TABLE_COLUMN_GAP) {
        cells.push([word.text]);
      } else {
        cells[cells.length - 1].push(word.text);
      }
      previousRight = word.right;
    }
    /*
     * Every cell through the same cleaning the editor uses. The rule is read as
     * a whole token often enough to be dropped above, but it also fuses to the
     * glyph beside it, as in "do|" and "|-", and a "|" left anywhere inside a
     * cell is
     * read back as a column boundary of ours, which splits the cell and shifts
     * every column after it.
     */
    const cleaned = cells
      .map((cell) => cleanCell(cell.join(" ")))
      .filter((cell) => cell !== "");
    if (cleaned.length > 0) {
      rows.push({ kind: "row", cells: cleaned });
    }
  }

  const block: TableBlock = rows.length === 0 ? [] : [rows];
  return serializeTable(block);
}

/** A token that is nothing but the table's own rule. */
function isRule(text: string): boolean {
  return /^\|+$/.test(text);
}

type Placed = {
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly middle: number;
  readonly height: number;
};

/**
 * The words grouped into the lines they are printed on.
 *
 * By the middle of a word rather than its top or bottom: a word box follows the
 * glyphs in it, so "you" and "speaking" on the same line differ at both edges
 * and agree in the middle. The line's own centre is kept as a running median
 * for the same reason.
 */
function groupLines(
  words: readonly Placed[],
  tolerance: number,
): readonly (readonly Placed[])[] {
  const ordered = [...words].sort((a, b) => a.middle - b.middle);
  const lines: Placed[][] = [];
  let current: Placed[] = [ordered[0]];

  for (const word of ordered.slice(1)) {
    const centre = median(current.map((one) => one.middle));
    if (Math.abs(word.middle - centre) > tolerance) {
      lines.push(current);
      current = [word];
    } else {
      current.push(word);
    }
  }
  lines.push(current);
  return lines;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
