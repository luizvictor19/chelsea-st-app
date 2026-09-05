import { boxes } from "./boxes.ts";
import { classify, type ExtractedBlock } from "./classify.ts";
import {
  BOX_PAGE_SEGMENTATION,
  POINT_LABEL_REACH,
  TABLE_HEIGHT,
} from "./constants.ts";
import { explanationLines, inkLines } from "./explanation-lines.ts";
import { boxLeft, crop, normalise, resize, shadedMask } from "./image.ts";
import { findMarkers } from "./markers.ts";
import { marginReadings, type MarginReading } from "./margin-numbers.ts";
import { repairClosingQuotes } from "./quotes.ts";
import { tableContent } from "./table-layout.ts";
import { joinTerms, termsFrom } from "./terms.ts";
import {
  reconcilePoints,
  type PageReadings,
  type Placement,
  type PointRange,
} from "./reconcile.ts";
import type { Band, Bitmap, OcrReader } from "./types.ts";

/** Panel text is small; the reference implementation reads it at double size. */
const BOX_READ_SCALE = 2;

export type ExtractedPage = {
  readonly id: string;
  readonly uploadIndex: number;
  /** The normalised page, kept so the review screen can show crops of it. */
  readonly page: Bitmap;
  readonly boxLeft: number;
  readonly readings: readonly MarginReading[];
  readonly boxCount: number;
  readonly structureCount: number;
  readonly lessonHeaders: readonly number[];
  readonly blocks: readonly ExtractedBlock[];
  /** Whether the slash density says this page is a dictation. */
  readonly isDictation: boolean;
  /** Set when the page is a kind this pipeline refuses to read. */
  readonly unsupported: "revision_exercise" | null;
};

/**
 * Words of the page that sit on a band, in reading order.
 *
 * Matched on the middle of the word rather than the whole of it. A band comes
 * from ink rows and a word box from the engine, and the two disagree by a pixel
 * or two at the edges; requiring containment drops the first or last line of a
 * paragraph depending on which way the rounding went.
 */
function textInBand(
  words: readonly { text: string; y: number; height: number }[],
  band: Band,
): string {
  // Repaired line by line, because the rule reads a line's shape and a band is
  // one line. Joining first would let one line's opening quote reach for a
  // closing quote on the next.
  return repairClosingQuotes(
    words
      .filter((word) => {
        const middle = word.y + word.height / 2;
        return middle >= band.top && middle <= band.bottom;
      })
      .map((word) => word.text)
      .join(" "),
  );
}

/**
 * Runs every stage over one page.
 *
 * The panels are read one at a time and enlarged, because that is how their
 * thresholds were measured. Everything else reuses the single full-page read:
 * asking the engine again for text it has already returned would cost seconds
 * per page and could not give a better answer.
 */
export async function extractPage(
  id: string,
  uploadIndex: number,
  source: Bitmap,
  reader: OcrReader,
): Promise<ExtractedPage> {
  const page = normalise(source);
  const mask = shadedMask(page);
  const left = boxLeft(mask);
  const bands = boxes(mask);

  const readings = await marginReadings(page, left, reader);
  const words = await reader.read(page);
  const tokens = words.map((word) => word.text);
  const pageText = tokens.join(" ");
  const markers = findMarkers(words);

  const boxRegions = [];
  for (const band of bands) {
    const region = crop(page, left, band.top, page.width, band.bottom);
    const enlarged = resize(
      region,
      region.width * BOX_READ_SCALE,
      region.height * BOX_READ_SCALE,
    );

    // A tall panel is a table, goes to the teacher anyway, and reads worse
    // under the fixed segmentation. An ordinary one is a list of terms laid out
    // in columns, and is read with the mode that does not drop a single letter.
    const isTable = band.bottom - band.top > TABLE_HEIGHT;
    const read = await reader.read(
      enlarged,
      isTable ? undefined : { pageSegmentation: BOX_PAGE_SEGMENTATION },
    );
    boxRegions.push({
      band,
      content: isTable
        ? tableContent(read, BOX_READ_SCALE)
        : joinTerms(termsFrom(read, BOX_READ_SCALE)),
    });
  }

  const asRegion = (band: Band) => ({ band, content: textInBand(words, band) });
  const lines = inkLines(page).map(asRegion);
  const explanations = explanationLines(page).map(asRegion);

  const result = classify({
    boxes: boxRegions,
    lines,
    explanations,
    markers,
    pageText,
    tokens,
  });

  const common = {
    id,
    uploadIndex,
    page,
    boxLeft: left,
    readings,
    boxCount: bands.length,
    structureCount: markers.length,
  };

  if (!result.supported) {
    return {
      ...common,
      lessonHeaders: [],
      blocks: [],
      isDictation: false,
      unsupported: result.reason,
    };
  }

  return {
    ...common,
    lessonHeaders: result.lessonHeaders,
    blocks: result.blocks,
    isDictation: result.isDictation,
    unsupported: null,
  };
}

export type ResolvedPage = {
  readonly extraction: ExtractedPage;
  /** Numbers settled for this page, ascending. */
  readonly points: readonly number[];
  /** The same numbers with the height each was printed at. */
  readonly placements: readonly Placement[];
  /** Where a page with no number of its own belongs. */
  readonly inheritedPoint: number | null;
  /** The point in force as the page begins, which owns what is above its first number. */
  readonly openingPoint: number | null;
  /** The page this is a second scan of. */
  readonly duplicateOf: string | null;
  /** Positions the batch could not settle, for the teacher to choose. */
  readonly disputes: readonly { y: number; candidates: readonly number[] }[];
  /** The lesson this page belongs to, inherited when it carries no header. */
  readonly lessonNumber: number | null;
  /** Whether that lesson starts on this page rather than being carried into it. */
  readonly opensLesson: boolean;
};

/**
 * Settles a whole upload: which page holds which number, which is a second scan
 * of another, and which lesson each belongs to.
 *
 * A page with no LESSON header inherits the last one seen, exactly as a page
 * with no margin number inherits the current point. Lesson boundaries come from
 * the header and never from the numbers, so a continuation page carries on in
 * the lesson it continues.
 */
export function resolveBatch(
  extractions: readonly ExtractedPage[],
  range: PointRange,
): readonly ResolvedPage[] {
  const readable = extractions.filter((page) => page.unsupported === null);
  const byId = new Map(extractions.map((page) => [page.id, page]));

  const input: PageReadings[] = readable.map((page) => ({
    id: page.id,
    uploadIndex: page.uploadIndex,
    readings: page.readings,
    boxCount: page.boxCount,
    structureCount: page.structureCount,
  }));

  const reconciliation = reconcilePoints(input, range);

  let lastLesson: number | null = null;
  const resolved: ResolvedPage[] = [];
  for (const page of reconciliation.pages) {
    const extraction = byId.get(page.id);
    if (extraction === undefined) {
      continue;
    }
    if (extraction.lessonHeaders.length > 0) {
      lastLesson =
        extraction.lessonHeaders[extraction.lessonHeaders.length - 1];
    }
    resolved.push({
      extraction,
      points: page.points,
      placements: page.placements,
      inheritedPoint: page.inheritedPoint,
      openingPoint: page.openingPoint,
      duplicateOf: page.duplicateOf,
      disputes: page.disputes,
      lessonNumber: lastLesson,
      opensLesson: extraction.lessonHeaders.length > 0,
    });
  }

  // Pages the pipeline refuses to read still have to appear, so the screen can
  // name what it turned away instead of dropping it silently.
  for (const page of extractions) {
    if (page.unsupported !== null) {
      resolved.push({
        extraction: page,
        points: [],
        placements: [],
        inheritedPoint: null,
        openingPoint: null,
        duplicateOf: null,
        disputes: [],
        lessonNumber: null,
        opensLesson: false,
      });
    }
  }

  return resolved;
}

/**
 * Whether an image is a book page at all.
 *
 * A page with no margin number is ordinary: continuation and dictation pages
 * carry none, and they inherit the point of the page before them. What is not
 * ordinary is an image with no number, no shaded panel, no lesson header and no
 * dictation paragraph. That is not a page of this book, and it is refused
 * rather than ingested as an empty point.
 */
export function isRefused(page: ExtractedPage): boolean {
  return (
    page.unsupported === null &&
    page.readings.length === 0 &&
    page.boxCount === 0 &&
    page.lessonHeaders.length === 0 &&
    !page.isDictation
  );
}

/**
 * Which point a block belongs to, or null when the page cannot say.
 *
 * The book's rule is that a block belongs to the last number printed above it,
 * and that rule is right about the middle of a page and wrong at both ends.
 *
 * At the top of a block, because the margin number is not printed above the
 * panel it names — it sits beside the panel's first line, up to POINT_LABEL_REACH
 * pixels inside it. Read literally, "the last number above" gave every one of
 * those panels to the number before, which on a spread means the whole of the
 * second point's opening panel filed under the first.
 *
 * At the top of a page, because content printed above a page's first number was
 * printed under the last number of the page before, and belongs there. Falling
 * back to this page's earliest number filed it under a point it was never
 * printed beneath.
 *
 * Null is an answer, and the caller has to carry it: it means nothing on the
 * page decides, and the teacher has to. That happens when the page opens the
 * upload, so there is no point before it, and when a number is missing between
 * the point the page opens in and the page's own first number — the missing one
 * was printed somewhere, and a block above the first number may belong to
 * either. Choosing there is the misfiling this rule exists to stop.
 *
 * @param openingPoint the point in force as the page begins, from the batch
 */
export function pointForBlock(
  placements: readonly Placement[],
  blockTop: number,
  openingPoint: number | null,
): number | null {
  // A number printed inside the block's top band names that block. Nearest
  // first, so two numbers close together cannot be decided by argument order.
  let label: Placement | null = null;
  for (const placement of placements) {
    const below = placement.y - blockTop;
    if (below >= 0 && below < POINT_LABEL_REACH) {
      if (label === null || placement.y < label.y) {
        label = placement;
      }
    }
  }
  if (label !== null) {
    return label.number;
  }

  let above: Placement | null = null;
  for (const placement of placements) {
    if (placement.y <= blockTop && (above === null || placement.y > above.y)) {
      above = placement;
    }
  }
  if (above !== null) {
    return above.number;
  }

  // Above every number the page carries.
  if (openingPoint === null) {
    return null;
  }
  let first: Placement | null = null;
  for (const placement of placements) {
    if (first === null || placement.y < first.y) {
      first = placement;
    }
  }
  // The page opens in its own first number when nothing in the book precedes
  // it, and then there is no gap to worry about.
  if (first !== null && first.number !== openingPoint) {
    // Points run consecutively, so a page whose first number is not the one
    // after the point it opens in has a number nobody read between the two.
    if (first.number !== openingPoint + 1) {
      return null;
    }
  }
  return openingPoint;
}

/**
 * The blocks of a page that nothing on it can file.
 *
 * Asked before anything is written, because a page holding one of these is a
 * page with a question outstanding, and confirming it would file that block
 * under whichever number happened to be nearest. Empty is the ordinary answer.
 */
export function unplacedBlocks<Block extends { readonly top: number }>(
  blocks: readonly Block[],
  placements: readonly Placement[],
  openingPoint: number | null,
): readonly Block[] {
  return blocks.filter(
    (block) => pointForBlock(placements, block.top, openingPoint) === null,
  );
}

/** The blocks of a page, review-first, as the review screen shows them. */
export function reviewOrder(
  blocks: readonly ExtractedBlock[],
): readonly ExtractedBlock[] {
  return [...blocks].sort((a, b) => {
    if (a.needsReview !== b.needsReview) {
      return a.needsReview ? -1 : 1;
    }
    return a.band.top - b.band.top;
  });
}

export { TABLE_HEIGHT };
