/**
 * The written form of a grammar table.
 *
 * These are the boxes the extractor cannot read: flattening a grid into one
 * line loses the pairing between columns, so a person retypes them. What they
 * type is what the student sees on the shared screen during the lesson, so it
 * needs one shape rather than a hundred and fifty.
 *
 * The convention, in three rules:
 *
 *   - one line per row of the table
 *   - columns separated by "|"
 *   - a blank line starts a new section, and a line with no "|" is that
 *     section's heading
 *
 * For example:
 *
 *   Present continuous (negative)
 *   I | am not speaking
 *   you | are not speaking
 *   he, she, it | is not speaking
 *   we, you, they | are not speaking
 *
 * The pipe rather than a slash, a semicolon or a tab: the slash is the
 * dictation's reading pause and would collide, a semicolon appears inside
 * ordinary text, a tab is invisible in a textarea, and the pipe already looks
 * like the rule between two columns.
 *
 * Deliberately not a spreadsheet. Books group rows under a heading and vary
 * between two and three columns, and anything richer would be one more thing to
 * remember a hundred and fifty times.
 */
export type TableRow = readonly string[];

export type TableSection = {
  /** The line above the rows, when the section has one. */
  readonly heading: string | null;
  readonly rows: readonly TableRow[];
};

export const COLUMN_SEPARATOR = "|";

/** An example in the convention, shown where the teacher types. */
export const GRAMMAR_TABLE_PLACEHOLDER = `Present continuous (negative)
I | am not speaking
you | are not speaking
he, she, it | is not speaking
we, you, they | are not speaking`;

/**
 * Reads the written form back into sections and rows.
 *
 * Forgiving about spacing, because it is typed by hand: cells are trimmed, and
 * a trailing separator does not invent an empty column at the end of a row.
 */
export function parseGrammarTable(content: string): readonly TableSection[] {
  const sections: TableSection[] = [];
  let heading: string | null = null;
  let rows: TableRow[] = [];

  const flush = () => {
    if (heading !== null || rows.length > 0) {
      sections.push({ heading, rows });
    }
    heading = null;
    rows = [];
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      flush();
      continue;
    }

    if (!line.includes(COLUMN_SEPARATOR)) {
      // A line with no column is a heading. One already standing means the
      // section beneath it has begun, so this starts the next one.
      if (heading !== null || rows.length > 0) {
        flush();
      }
      heading = line;
      continue;
    }

    const cells = line.split(COLUMN_SEPARATOR).map((cell) => cell.trim());
    while (cells.length > 1 && cells[cells.length - 1] === "") {
      cells.pop();
    }
    rows.push(cells);
  }
  flush();

  return sections;
}

/** How many columns the widest row of a section uses. */
export function columnCount(section: TableSection): number {
  return section.rows.reduce((widest, row) => Math.max(widest, row.length), 0);
}
