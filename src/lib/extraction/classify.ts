import {
  CHART_REFERENCE,
  DICTATION_SLASH_RATIO,
  LESSON_HEADER,
  REVISION_EXERCISE_HEADING,
  REVISION_EXERCISE_MARKER,
  TABLE_HEIGHT,
} from "./constants.ts";
import type { Band } from "./types.ts";

/** Mirrors the block_kind enum in migration 0004. */
export type BlockKind =
  | "vocabulary"
  | "grammar_table"
  | "explanation"
  | "dictation"
  | "revision_exercise"
  | "chart_ref";

export type ExtractedBlock = {
  readonly kind: BlockKind;
  readonly content: string;
  readonly needsReview: boolean;
  /** Where it sat on the page, which orders the blocks and locates the crop. */
  readonly band: Band;
};

/** A box already read, paired with the band it came from. */
export type ReadRegion = {
  readonly band: Band;
  readonly content: string;
};

export type ClassifyInput = {
  readonly boxes: readonly ReadRegion[];
  readonly explanations: readonly ReadRegion[];
  readonly pageText: string;
  readonly tokens: readonly string[];
};

export type ClassifyResult =
  | {
      readonly supported: false;
      /** Named so the screen can say which kind of page it refused. */
      readonly reason: "revision_exercise";
    }
  | {
      readonly supported: true;
      readonly lessonHeaders: readonly number[];
      readonly isDictation: boolean;
      readonly slashRatio: number;
      readonly blocks: readonly ExtractedBlock[];
    };

function allMatches(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))].map(
    (match) => Number(match[1]),
  );
}

/** Share of tokens carrying a slash, which is what marks a dictation page. */
export function slashRatio(tokens: readonly string[]): number {
  if (tokens.length === 0) {
    return 0;
  }
  return tokens.filter((token) => token.includes("/")).length / tokens.length;
}

/**
 * Turns the measured signals of one page into the blocks it contributes.
 *
 * Every decision here is geometric or a regex over the page text; none of it
 * reads meaning. That is deliberate, because it keeps working when the OCR
 * spells a word wrong.
 */
export function classify(input: ClassifyInput): ClassifyResult {
  // A revision exercise page is a second page type this pipeline cannot read:
  // most of it is shaded, so the band detector returns one enormous box and
  // would ingest the whole page as a single unreadable table. Refusing it is
  // the only honest answer until it gets its own path.
  //
  // The heading requires the parenthesised lesson range. The looser
  // "Do Revision Exercise N" marker appears on ordinary dictation pages, and
  // those are extracted normally.
  if (REVISION_EXERCISE_HEADING.test(input.pageText)) {
    return { supported: false, reason: "revision_exercise" };
  }

  const ratio = slashRatio(input.tokens);
  const isDictation = ratio >= DICTATION_SLASH_RATIO;
  const blocks: ExtractedBlock[] = [];

  // Ink inside a panel is still ink, so the line finder reports panel text as
  // well as prose. It is the box's content, already captured, so anything
  // overlapping a box band is dropped here rather than becoming a second block
  // holding the same words.
  const prose = input.explanations.filter(
    (line) =>
      !input.boxes.some(
        (box) =>
          line.band.top < box.band.bottom && line.band.bottom > box.band.top,
      ),
  );

  for (const box of input.boxes) {
    const isTable = box.band.bottom - box.band.top > TABLE_HEIGHT;
    blocks.push({
      // A tall box is a conjugation table or comparison grid. Flattened into one
      // line it loses the column pairing, so it is handed to the teacher rather
      // than trusted.
      kind: isTable ? "grammar_table" : "vocabulary",
      content: box.content,
      needsReview: isTable,
      band: box.band,
    });
  }

  if (isDictation) {
    // The dictation is the run of slashed lines; the slashes are the reading
    // pauses and are kept exactly as they came.
    const spoken = prose.filter((line) => line.content.includes("/"));
    if (spoken.length > 0) {
      blocks.push({
        kind: "dictation",
        content: spoken.map((line) => line.content).join(" "),
        needsReview: false,
        band: {
          top: spoken[0].band.top,
          bottom: spoken[spoken.length - 1].band.bottom,
        },
      });
    }
  } else {
    // Adjacent justified lines are one paragraph, so they become one block
    // rather than one block per line.
    for (const paragraph of groupAdjacent(prose)) {
      blocks.push({
        kind: "explanation",
        content: paragraph.map((line) => line.content).join(" "),
        needsReview: false,
        band: {
          top: paragraph[0].band.top,
          bottom: paragraph[paragraph.length - 1].band.bottom,
        },
      });
    }
  }

  for (const number of allMatches(input.pageText, REVISION_EXERCISE_MARKER)) {
    blocks.push({
      kind: "revision_exercise",
      content: `Revision Exercise ${number}`,
      needsReview: false,
      band: { top: 0, bottom: 0 },
    });
  }

  for (const number of allMatches(input.pageText, CHART_REFERENCE)) {
    blocks.push({
      kind: "chart_ref",
      content: `See Chart ${number}`,
      needsReview: false,
      band: { top: 0, bottom: 0 },
    });
  }

  return {
    supported: true,
    lessonHeaders: allMatches(input.pageText, LESSON_HEADER),
    isDictation,
    slashRatio: ratio,
    blocks: blocks.sort((a, b) => a.band.top - b.band.top),
  };
}

/**
 * Splits lines into paragraphs wherever a blank run wider than a line appears.
 * Uses the lines' own heights as the yardstick, so it does not need a threshold
 * of its own.
 */
function groupAdjacent(lines: readonly ReadRegion[]): ReadRegion[][] {
  const groups: ReadRegion[][] = [];
  for (const line of lines) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    const lineHeight = line.band.bottom - line.band.top;
    if (
      previous !== undefined &&
      line.band.top - previous.band.bottom <= lineHeight
    ) {
      current.push(line);
    } else {
      groups.push([line]);
    }
  }
  return groups;
}
