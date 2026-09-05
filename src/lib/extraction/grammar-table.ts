/**
 * The written form of a grammar table, and the model the editor works on.
 *
 * These are the boxes the extractor cannot read: flattening a grid into one
 * line loses the pairing between columns, so a person rebuilds them. What they
 * rebuild is what the student sees on the shared screen during the lesson.
 *
 * The stored form is unchanged and stays plain text in blocks.content:
 *
 *   - one line per row of the table, columns separated by "|"
 *   - a blank line starts a new section
 *   - a line with no "|" is that section's heading
 *
 * A line with no "|" is ambiguous, though: it is a heading in a table that has
 * columns, and it is a one-column row in a table the extractor flattened
 * completely. The rule below decides, and the editor lets the teacher overrule
 * it, because a program guessing this in silence is how a heading becomes a row
 * of the lesson.
 */
export type TableLine =
  | { readonly kind: "title"; readonly text: string }
  | { readonly kind: "row"; readonly cells: readonly string[] };

/** Lines between two blank lines. */
export type TableSection = readonly TableLine[];

export type TableBlock = readonly TableSection[];

export const COLUMN_SEPARATOR = "|";

/**
 * Whether this block has any column at all.
 *
 * With no separator anywhere, nothing on the page was ever a heading: the
 * extractor found a table it could not split, so every line is a row of one
 * cell running the full width. With a separator somewhere, the format's own
 * rule applies and a line without one is a heading.
 */
function hasAnyColumn(content: string): boolean {
  return content.includes(COLUMN_SEPARATOR);
}

function parseCells(line: string): readonly string[] {
  const cells = line.split(COLUMN_SEPARATOR).map((cell) => cell.trim());
  // A trailing separator marks a row of one cell rather than inventing an empty
  // column at the end. It is what tells "some | " apart from the heading "some".
  while (cells.length > 1 && cells[cells.length - 1] === "") {
    cells.pop();
  }
  return cells;
}

export function parseTable(content: string): TableBlock {
  const columned = hasAnyColumn(content);
  const sections: TableLine[][] = [];
  let current: TableLine[] = [];

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      if (current.length > 0) {
        sections.push(current);
        current = [];
      }
      continue;
    }
    if (columned && !line.includes(COLUMN_SEPARATOR)) {
      current.push({ kind: "title", text: line });
    } else {
      current.push({ kind: "row", cells: parseCells(line) });
    }
  }
  if (current.length > 0) {
    sections.push(current);
  }
  return sections;
}

/**
 * Back to the stored form, so that parsing it again gives the same model.
 *
 * A one-cell row is written with a trailing separator whenever the block holds
 * a column or a heading anywhere, because without it the line would read back
 * as a heading. A block that is nothing but one-cell rows needs no separator at
 * all: the rule above already reads every line of it as a row.
 */
export function serializeTable(block: TableBlock): string {
  const needsMarker = block.some((section) =>
    section.some(
      (line) =>
        line.kind === "title" || (line.kind === "row" && line.cells.length > 1),
    ),
  );

  return block
    .map((section) =>
      section
        .map((line) => {
          if (line.kind === "title") {
            return line.text;
          }
          if (line.cells.length > 1) {
            return line.cells.join(` ${COLUMN_SEPARATOR} `);
          }
          const only = line.cells[0] ?? "";
          return needsMarker ? `${only} ${COLUMN_SEPARATOR}` : only;
        })
        .join("\n"),
    )
    .join("\n\n");
}

/** The widest row of a section, which is how many columns the grid draws. */
export function columnCount(section: TableSection): number {
  return section.reduce(
    (widest, line) =>
      line.kind === "row" ? Math.max(widest, line.cells.length) : widest,
    0,
  );
}

/** What a cell may hold: no separator, and no run of blank space. */
export function cleanCell(text: string): string {
  // A "|" typed into a cell would split it into two columns behind whoever
  // typed it, which is the one thing the editor must never do quietly.
  return text.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Cuts a cell in two at a character offset, which on screen is the cursor.
 *
 * This is how a row the extractor could not split becomes a table again: the
 * teacher puts the cursor where the next column starts and presses Enter. An
 * offset that would leave either half empty cuts nothing, so pressing Enter at
 * the end of a cell is not a split but the end of an edit.
 */
export function splitCellAt(
  line: TableLine,
  cellIndex: number,
  offset: number,
): TableLine {
  if (line.kind !== "row") {
    return line;
  }
  const cell = line.cells[cellIndex];
  if (cell === undefined) {
    return line;
  }
  const left = cleanCell(cell.slice(0, offset));
  const right = cleanCell(cell.slice(offset));
  if (left === "" || right === "") {
    return line;
  }
  const cells = [...line.cells];
  cells.splice(cellIndex, 1, left, right);
  return { kind: "row", cells };
}

/** Turns a heading into a one-cell row and back, when the rule guessed wrong. */
export function toggleLineKind(line: TableLine): TableLine {
  if (line.kind === "title") {
    return { kind: "row", cells: [line.text] };
  }
  return { kind: "title", text: line.cells.join(" ").trim() };
}
