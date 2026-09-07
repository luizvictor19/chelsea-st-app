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

  const lines = groupLines(placed, toleranceOf(placed)).map((line) =>
    [...line].sort((a, b) => a.left - b.left),
  );
  const columns = panelColumns(lines);
  const rows: TableLine[] = [];

  for (const line of lines) {
    /*
     * A line that runs across the panel is one phrase, and is written as the
     * heading it is. Assigned by x like any other it would be torn along the
     * columns under it: "Present simple (positive)" came back as three cells
     * with an empty one in the middle, which is a row the book does not have.
     * See `spansPanel`.
     */
    if (spansPanel(line, columns)) {
      const spanning = cleanCell(line.map((word) => word.text).join(" "));
      if (spanning !== "") {
        rows.push({ kind: "title", text: spanning });
      }
      continue;
    }
    const cells: string[][] = columns.map(() => []);
    for (const word of line) {
      cells[columnAt(columns, word.left)].push(word.text);
    }
    /*
     * Every cell through the same cleaning the editor uses. The furniture is a
     * token of its own often enough to be dropped above, but it also fuses to
     * the glyph beside it, as in "do|" and "|-", and a "|" left anywhere inside
     * a cell is read back as a column boundary of ours, which splits the cell
     * and shifts every column after it.
     */
    const cleaned = cells.map((cell) => cleanCell(cell.join(" ")));
    /*
     * A cell empty at the end of a row is dropped and one empty inside it is
     * kept. Inside, the emptiness is the information: it says which column the
     * row skipped, and without it every cell after would shift left by one. At
     * the end there is nothing to shift, the grid draws its width from its
     * widest row either way, and `parseCells` drops trailing empties when it
     * reads the block back, so writing them would not survive a round trip.
     */
    while (cleaned.length > 0 && cleaned[cleaned.length - 1] === "") {
      cleaned.pop();
    }
    if (cleaned.some((cell) => cell !== "")) {
      rows.push({ kind: "row", cells: cleaned });
    }
  }

  const block: TableBlock = rows.length === 0 ? [] : [rows];
  return serializeTable(block);
}

/**
 * Whether this line is one phrase laid across the panel rather than a row.
 *
 * The heading of a conjugation panel is printed as one line at the top, and its
 * words fall wherever the phrase happens to reach: on p056 of book 2 it puts
 * "Present" at 18, "simple" at 141 and "(positive)" at 258, over a grid whose
 * columns start at 16, 113 and 171. Assigned word by word it comes apart into
 * three cells, and the pairing the grid exists to show gains a row that is not
 * one.
 *
 * Three things together say it is a phrase and not a row, and none of them is a
 * threshold of its own:
 *
 *   1. the words form one uninterrupted run, with no gap inside it wide enough
 *      to propose a column. A row of two cells has that gap by construction,
 *      which is what made the column in the first place;
 *   2. it starts in the panel's first column. "none", "nobody" and "not
 *      anybody" are single runs too, and they are cells: they start in the
 *      second column, and taking them there is the whole point of reading the
 *      columns off the panel;
 *   3. it reaches past the second column, so the assignment would in fact cut
 *      it. A short run inside the first column is already one cell and needs no
 *      rule.
 *
 * Measured over the 18 grid panels of both books: it fires on 8 lines and all 8
 * are the panel's heading, so what it names is always a heading. It is not the
 * whole population of headings, and is not meant to be. "To have", the heading
 * of the panel at 868 of book 1, is short enough to end inside the first
 * column, so nothing would have cut it and this leaves it alone as the one-cell
 * row it already was. The rule answers "would the grid tear this line", which
 * is the question the columns raise, and not "is this line a heading", which
 * the body-size measurement failed to answer and this does not reopen.
 */
function spansPanel(
  line: readonly Placed[],
  columns: readonly number[],
): boolean {
  if (line.length === 0 || columns.length < 2) {
    return false;
  }
  for (let index = 1; index < line.length; index += 1) {
    if (line[index].left - line[index - 1].right >= TABLE_COLUMN_GAP) {
      return false;
    }
  }
  return (
    columnAt(columns, line[0].left) === 0 &&
    columnAt(columns, line[line.length - 1].left) > 0
  );
}

/**
 * Where the panel's columns start, in page pixels, left to right.
 *
 * The columns of a printed grid belong to the panel, not to a line of it. Cut
 * line by line, a wide term and the glyph beside it can sit closer than
 * TABLE_COLUMN_GAP and weld, while the lines above and below part at exactly
 * that place: point 36 of book 1 read "question mark ?" as one cell because
 * "question mark" is long, and the two rows under it found the same column
 * without trouble. A line is not enough evidence about a column; the panel is.
 *
 * So the gap proposes and the panel decides. Every line is cut at
 * TABLE_COLUMN_GAP, which is what keeps the second word of "full stop" from
 * standing as a column of its own, and only the resulting starts are candidates.
 * The candidates are then grouped across the whole panel, again at
 * TABLE_COLUMN_GAP, and each group is one column of the grid. See
 * `columnAt` for how a line that never proposed a column still lands in it.
 *
 * A group is placed at its leftmost candidate, which is also what bounds it: a
 * candidate opens a new column when it is TABLE_COLUMN_GAP or more from the
 * column already open, so every start that formed a group falls at or after its
 * own column and never one to the left, and no group is wider than the gap.
 */
function panelColumns(
  lines: readonly (readonly Placed[])[],
): readonly number[] {
  const starts: number[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    starts.push(line[0].left);
    let previousRight = line[0].right;
    for (const word of line.slice(1)) {
      if (word.left - previousRight >= TABLE_COLUMN_GAP) {
        starts.push(word.left);
      }
      previousRight = word.right;
    }
  }

  const ordered = [...starts].sort((a, b) => a - b);
  const columns: number[] = [];
  for (const start of ordered) {
    /*
     * Against the column already open and not against the candidate before it.
     * Compared against the predecessor the groups chain: starts at 16, 60 and
     * 110 would collapse into one column at 16, though 110 is 94px away from
     * it, and the two columns of every row under it would land in one cell.
     * Anchored on the leftmost member a group can never be wider than the gap
     * itself, which is what the grouping claims to be. It matters because the
     * real columns are tight: p056 of book 2 has columns 58px apart against a
     * 54px cut, so one stray candidate between two of them is all it takes.
     */
    if (
      columns.length === 0 ||
      start - columns[columns.length - 1] >= TABLE_COLUMN_GAP
    ) {
      columns.push(start);
    }
  }
  return columns;
}

/**
 * Which column a word belongs to, by where it starts.
 *
 * The last column that begins at or before the word, which is the whole of the
 * assignment: a word inside a cell starts after its column and before the next,
 * and a word the line-by-line cut had welded to the cell before it starts at
 * the next column and is taken there. No threshold of its own, and no appeal to
 * what the line did: the panel already said where the columns are.
 */
function columnAt(columns: readonly number[], left: number): number {
  let at = 0;
  for (let index = 1; index < columns.length; index += 1) {
    if (columns[index] <= left) {
      at = index;
    }
  }
  return at;
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
