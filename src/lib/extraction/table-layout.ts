import {
  TABLE_COLUMN_GAP,
  TABLE_LINE_TOLERANCE,
  TABLE_STEM_HEIGHT,
} from "./constants.ts";
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
/**
 * How many printed lines of text a panel holds.
 *
 * This is the grid signal. It is counted with the same grouping and the same
 * furniture rule `tableContent` uses, so a panel called a grid here is cut into
 * exactly these lines when it is read as one.
 *
 * Lines and not height, which is what the pipeline used to ask. A line count
 * does not move with the normalisation width or with the body size the printer
 * chose, and a height does: the punctuation grid of book 1 is three lines and
 * 187px, under a threshold measured on book 2's conjugation panels, so it went
 * down the vocabulary path and had its rows welded into one list of terms.
 */
export function printedLines(words: readonly OcrWord[], scale = 1): number {
  const placed = placedWords(words, scale);
  return placed.length === 0
    ? 0
    : groupLines(placed, toleranceOf(placed)).length;
}

export function tableContent(words: readonly OcrWord[], scale = 1): string {
  const placed = placedWords(words, scale);

  if (placed.length === 0) {
    return "";
  }

  const rows: TableLine[] = [];

  for (const line of groupLines(placed, toleranceOf(placed))) {
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
     * Every cell through the same cleaning the editor uses. The furniture is a
     * token of its own often enough to be dropped above, but it also fuses to
     * the glyph beside it, as in "do|" and "|-", and a "|" left anywhere inside
     * a cell is read back as a column boundary of ours, which splits the cell
     * and shifts every column after it.
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

/** A token that is nothing but a bare vertical stem, whatever drew it. */
function isStem(text: string): boolean {
  return /^\|+$/.test(text);
}

/** How far off a line's centre a word may sit and still be on that line. */
function toleranceOf(placed: readonly Placed[]): number {
  return median(placed.map((word) => word.height)) * TABLE_LINE_TOLERANCE;
}

/**
 * The panel's words in page coordinates, with the furniture out and the stems
 * that are letters read as letters.
 *
 * Shared by the two questions asked of a panel, how many lines it has and what
 * its grid holds, so the second cannot disagree with the first about what a
 * line is.
 *
 * The body height the stems are judged against leaves the stems out, since they
 * are the thing being measured, and the tall ones would drag the yardstick up
 * towards themselves. It is the panel's and not the line's, because a stem can
 * be alone on its line with nothing beside it to compare against, which is how
 * the "I" of p060 is printed. See TABLE_STEM_HEIGHT.
 */
function placedWords(
  words: readonly OcrWord[],
  scale: number,
): readonly Placed[] {
  const read = words
    .map((word) => ({
      text: word.text.trim(),
      left: word.x / scale,
      right: (word.x + word.width) / scale,
      middle: (word.y + word.height / 2) / scale,
      height: word.height / scale,
    }))
    .filter((word) => word.text !== "");
  const body = median(
    read.filter((word) => !isStem(word.text)).map((word) => word.height),
  );
  return (
    read
      // A stem the height of the type is the pronoun "I", which this face draws
      // with no serif and no crossbar. Dropped with the furniture, as it was,
      // "I am" reached the teacher as "am" and nothing said a word had gone.
      .map((word) =>
        isStem(word.text) && word.height <= body * TABLE_STEM_HEIGHT
          ? { ...word, text: "I" }
          : word,
      )
      // What is left of them is the panel's own furniture: the bracket holding
      // a group of subjects together and the rule closing the box. "|" is the
      // column boundary of the stored form, so either would come back as a
      // boundary of ours, in the middle of a cell.
      .filter((word) => !isStem(word.text))
  );
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
