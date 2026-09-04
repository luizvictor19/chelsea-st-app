/**
 * Every threshold the extractor uses, with where the number came from.
 *
 * Provenance matters more than the values: these were measured over 61 real
 * pages of book 2 with the Tesseract 5 CLI, recorded in docs/extract_prototype.py
 * and in the manifest that ships with the pages. Changing one without a new
 * measurement is how a pipeline quietly stops matching the book it was built
 * for, so each constant says what it was measured against.
 *
 * Re-measured against this port under tesseract.js 7 over the same 61 pages,
 * with scripts/calibrate-extraction.ts. The result kept every value below:
 *
 * - Box detection, table flagging and dictation detection matched the CLI
 *   baseline on all 61 pages exactly.
 * - Margin reading recovered all 76 point numbers, the same as the CLI. The
 *   raw readings differ on 27 pages, but only in which false positives appear:
 *   no true number was lost. That is expected and is why the spec validates by
 *   sequence and ceiling rather than by confidence.
 * - Explanation lines matched on 60 of 61 pages, 190 lines against 189. The one
 *   extra line is a boundary case: this resampler is not bit-identical to the
 *   PIL Lanczos the baseline was taken with, and one line on p117-118 sits close
 *   enough to the justification test to move across it. Not worth chasing PIL's
 *   exact fixed-point arithmetic for; recorded here so the discrepancy is known
 *   rather than discovered later.
 */

/** Normalisation width. Below this the margin digits stop resolving. */
export const TARGET_WIDTH = 1100;

// --- Shaded band detection -------------------------------------------------
// The shaded panel is (232,235,243): slightly blue, never white, never dark.
// Expressed as a relation rather than an exact colour so JPEG-ish noise and a
// rescaled screenshot still match.

/** Blue must lead red by at least this much. */
export const SHADE_BLUE_OVER_RED = 4;
/** Above this red the pixel is page white, not panel. */
export const SHADE_RED_MAX = 250;
/** Below this red the pixel is ink or a rule, not panel. */
export const SHADE_RED_MIN = 200;

/** A row belongs to a band when at least this share of it is shaded. */
export const ROW_SHADED_FRACTION = 0.45;
/**
 * Bands closer than this are one box split by dense text: a line packed with
 * words loses enough shaded pixels to fall under ROW_SHADED_FRACTION.
 */
export const MERGE_GAP = 16;
/** Below this height a band is an underline artifact, never content. */
export const MIN_BOX_HEIGHT = 35;
/**
 * Above this a box is a conjugation table or comparison grid. Flattening one
 * into a single line loses the column pairing, so it is flagged for review
 * rather than trusted.
 */
export const TABLE_HEIGHT = 250;

// --- Margin numbers --------------------------------------------------------

/**
 * Crop offsets from box_left, paired with the Tesseract page segmentation mode
 * to read them with. No single combination finds every number; the union of
 * these three found all 76 across the measured set.
 */
export const MARGIN_READ_CONFIGS = [
  { padding: -2, pageSegmentation: 6 },
  { padding: 22, pageSegmentation: 6 },
  { padding: 14, pageSegmentation: 11 },
] as const;

/** The margin strip is enlarged before reading; small digits do not survive otherwise. */
export const MARGIN_UPSCALE = 5;
/** A number starting to the right of this, relative to box_left, is page text. */
export const MARGIN_RIGHT_TOLERANCE = 12;
/** Longer than this is a run of digits stuck together, not a point number. */
export const MARGIN_MAX_DIGITS = 4;

// --- Explanation lines -----------------------------------------------------

/** Below this grey level a pixel counts as ink. */
export const INK_LEVEL = 160;
/** A row with fewer ink pixels than this is blank. */
export const MIN_ROW_INK = 2;
/** Shorter than this a run of rows is noise, not a line of text. */
export const MIN_LINE_HEIGHT = 6;
/** How far a line may start from box_left and still count as justified. */
export const EXPLANATION_LEFT_TOLERANCE = 15;
/**
 * The widest internal gap a justified line may contain. Question and answer
 * pages are set in two columns and always leave a bigger one.
 */
export const EXPLANATION_MAX_GAP = 25;

// --- Page kinds ------------------------------------------------------------

/**
 * Share of tokens containing a slash above which the page is a dictation.
 * Measured separation is wide: dictation pages ran 0.112 to 0.349 and every
 * other page stayed at or below 0.062.
 */
export const DICTATION_SLASH_RATIO = 0.1;

/** `LESSON 17`, the only thing that starts a lesson. */
export const LESSON_HEADER = /LESSON\s+(\d+)/g;
/** `Do Revision Exercise 4`, a marker inside an ordinary page. */
export const REVISION_EXERCISE_MARKER = /Revision\s+Exercise\s+(\d+)/gi;
/** `See Chart 9`. */
export const CHART_REFERENCE = /See\s+Chart\s+(\d+)/gi;
/**
 * The heading of a revision exercise page, which is a second page type the
 * pipeline cannot read yet. The parenthesised lesson range is required: without
 * it this would also match the `Do Revision Exercise N` marker that appears on
 * ordinary dictation pages, which are extracted normally.
 */
export const REVISION_EXERCISE_HEADING =
  /Revision\s+Exercise\s+\d+\s*\(\s*Lessons\s+\d+\s*.\s*\d+\s*\)/i;
