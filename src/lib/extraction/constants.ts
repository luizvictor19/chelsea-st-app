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
 * - Explanation lines have since been deliberately taken past the baseline. The
 *   reference implementation measured justification against the left edge of the
 *   shaded panel, which is not where the text column starts: the two agree only
 *   on pages that have a panel. Measuring against the text itself finds 225
 *   lines against the baseline's 189, on 15 pages, and loses none. It is what
 *   recovers the present-continuous explanation on p057-058, which the baseline
 *   reported as an empty page.
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

/**
 * The blank that separates one term from the next inside a shaded panel.
 *
 * Terms are laid out in columns, not run together with spaces, so "a day" and
 * "flower plant" are lexically identical and only the geometry tells them apart.
 * Splitting on whitespace made "a day" two terms and "the fewest" two more, and
 * those went into vocabulary_items as words the sentence generator would then
 * be allowed to use on their own.
 *
 * Measured over the ordinary panels of the 61 fixtures: 68 gaps fall between 8
 * and 19 pixels, 170 fall at 70 or more, and nothing at all falls in between.
 * The cut sits in the middle of that fifty-pixel void rather than on an edge.
 */
export const TERM_COLUMN_GAP = 45;

/**
 * The gap between two words that means a column boundary, inside a table panel.
 *
 * The same geometry as the vocabulary panels and the same measurement, made
 * separately because the population is different: 13 tall panels across the 61
 * fixtures, 118 gaps between words sitting on the same line. 61 of them are
 * 39.5px or less and fall inside a cell, 57 are 68.5px or more and fall between
 * columns, and nothing at all lands in the 29px between. The cut sits in the
 * middle of that void rather than on an edge.
 */
export const TABLE_COLUMN_GAP = 54;

/**
 * How far off a line's centre a word may sit and still belong to that line, as
 * a fraction of the median word height in the panel.
 *
 * Measured over the same 13 panels: of 211 words, none sits further than 0.39
 * of a word height from the centre of its line, and the two closest lines are
 * 0.89 apart. Every value from 0.4 to 0.88 groups these panels identically, so
 * this is the middle of that void too. Expressed as a fraction because the
 * panels are read enlarged and a panel's own type size is what sets the scale.
 */
export const TABLE_LINE_TOLERANCE = 0.64;

/**
 * Page segmentation for reading an ordinary panel.
 *
 * Measured over the 151 panels: against the automatic mode this changes 3 of
 * the 139 ordinary ones, recovering the "a" of "a some" that the automatic mode
 * drops and adding a stray pipe twice. A lost word is silent and permanent,
 * since it never reaches vocabulary_items; a stray pipe is visible in the
 * review field. Nine of the twelve disagreements are in the tall panels, which
 * a person rewrites anyway, so those keep the automatic mode.
 */
export const BOX_PAGE_SEGMENTATION = 6;

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

/**
 * Readings closer together than this belong to the same physical number, and
 * are competing guesses at it rather than two numbers. Measured at the
 * normalised width.
 */
export const MARGIN_GROUP_Y_TOLERANCE = 30;

/**
 * How many of the margin crops must have seen a number for it to stand alone.
 *
 * The three crops are read independently, and a number two of them found is not
 * one engine's slip. This was a literal `2` inside the reconciler for a long
 * time, with margin-numbers.ts saying beside it that the count was "a
 * diagnostic, not yet a decision: no rule uses it until there is a measurement
 * saying it separates signal from noise". Both could not be true. This is the
 * measurement, made with scripts/measure-agreement-gate.ts against the
 * hand-read truth of both books.
 *
 * It separates them, and the digit count does not change that: the gate refuses
 * 3 of 51 true numbers in book 1, whose points run 1 to 52 and are mostly one
 * digit, and 4 of 78 in book 2, whose points run 53 to 128. It admits none of
 * the one noise reading in book 1's range and one of the three in book 2's.
 *
 * What the measurement did change is what happens to the refusals. In book 2
 * they fall on four different pages, three of which carry another number that
 * was corroborated, so the page settles anyway. In book 1 all three fall on one
 * page — the first, the only one carrying three points — and that page had
 * nothing left to bootstrap from. Hence MARGIN_CHAIN_MINIMUM below.
 */
export const MARGIN_AGREEMENT = 2;

/**
 * How many numbers a page must carry for its own printed order to corroborate
 * them.
 *
 * The numbers run down the margin in increasing order: that is how the book is
 * printed, not a guess about it. A page whose every position holds exactly one
 * candidate, and whose candidates increase in the order they are printed, has
 * said something about itself that no single reading could.
 *
 * Two, not one. A page carrying one number has no order to corroborate
 * anything, and a lone reading no crop confirmed is exactly the shape noise
 * takes: 29 of the 31 noise readings measured in book 2 were seen once. At two
 * this fires on one page in the 31 of book 1 and none of the 61 of book 2, and
 * admits no noise in either — every noise reading inside a book's own range
 * either shares a position with a real number or holds two candidates, and
 * neither is a chain.
 */
export const MARGIN_CHAIN_MINIMUM = 2;

/**
 * How far below a block's top the number that names it may be printed.
 *
 * The margin number is not printed above the panel it labels. It sits beside
 * the panel's first line, a little inside it, so "the last number printed above
 * this block" — read literally — hands the panel to the number before it.
 *
 * Measured over both books with scripts/measure-agreement-gate.ts: of 69 numbers
 * that name a block, 29 in book 1 and 40 in book 2, none sits more than 23px
 * below that block's top, and the next block up is never closer than 72px. The
 * cut sits at 47, in the middle of that 49px void, rather than on an edge.
 */
export const POINT_LABEL_REACH = 47;

// --- Explanation lines -----------------------------------------------------

/** Below this grey level a pixel counts as ink. */
export const INK_LEVEL = 160;
/** A row with fewer ink pixels than this is blank. */
export const MIN_ROW_INK = 2;
/** Shorter than this a run of rows is noise, not a line of text. */
export const MIN_LINE_HEIGHT = 6;
/**
 * Two lines starting within this many pixels of each other begin in the same
 * column. A glyph with a round left side sits a pixel inside one with a stem.
 */
export const MARGIN_JITTER = 2;
/** How far a line may start from the text margin and still count as justified. */
export const EXPLANATION_LEFT_TOLERANCE = 15;
/**
 * How far short of the right margin a justified line may stop.
 *
 * Prose is justified on both sides, so a line of it reaches the column's right
 * edge. A question whose answer begins on the line below has no internal gap and
 * passes the gap test, but it stops well short: measured, the column ends at
 * 1007 and such a question ends at 944.
 *
 * Measured over the 61 fixtures, 15px and 30px discard the same 55 lines and
 * 50px discards 51, so 30 sits in the middle of a plateau rather than on an
 * edge.
 */
export const EXPLANATION_RIGHT_TOLERANCE = 30;

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
 * `Dictation 7`. Set in light italic beside an icon, so OCR reads it about one
 * time in eight; the page is identified by slash density instead. It is listed
 * here because when it is read, its line has to be kept out of the prose test.
 */
export const DICTATION_MARKER = /Dictation\s+(\d+)/gi;
/**
 * The heading of a revision exercise page, which is a second page type the
 * pipeline cannot read yet. The parenthesised lesson range is required: without
 * it this would also match the `Do Revision Exercise N` marker that appears on
 * ordinary dictation pages, which are extracted normally.
 */
export const REVISION_EXERCISE_HEADING =
  /Revision\s+Exercise\s+\d+\s*\(\s*Lessons\s+\d+\s*.\s*\d+\s*\)/i;
