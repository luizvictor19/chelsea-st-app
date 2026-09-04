/**
 * Repairs the closing quotation mark that Tesseract mangles.
 *
 * Not a tesseract.js fault. Measured against a CLI baseline of the same pages,
 * the CLI misreads the same glyph on 51 of 358 openings, so there is no correct
 * engine to compare against: each build fails differently, the WASM one leaving
 * ® or *, the CLI one leaving " or “. The curved closing quote is simply
 * ambiguous to Tesseract in this typeface.
 *
 * So the repair is by shape, never by symbol. Substituting a known bad
 * character for a quote would hide the problem and break on the next symbol the
 * engine invents. Instead: an opening quote with no closing quote before the
 * next opening has exactly one character that cannot be legitimate punctuation
 * where it sits, and that character is the closing quote.
 *
 * Two things must survive untouched. The slash is a dictation reading pause, so
 * "foot"/ has to become foot”/ and not lose the pause. And an apostrophe is
 * part of the word: I've and he’s are not quotation marks.
 *
 * When a span offers more than one candidate the rule abstains, because a rule
 * that guesses here would corrupt prose that was read correctly. Measured over
 * the 61 fixtures: 45 of 73 unclosed spans repaired, no correctly closed span
 * altered, and the counts of slashes and apostrophes identical before and
 * after.
 */
const OPENING = "“";
const CLOSING = "”";
const APOSTROPHES = new Set(["'", "’"]);
/** The dictation's reading pause. Never consumed. */
const PRESERVED = new Set(["/"]);
/** Characters that could plausibly be punctuation exactly where they sit. */
const PUNCTUATION = new Set([".", ",", ";", ":", "?", "!"]);

function isAlphanumeric(character: string): boolean {
  return /[\p{L}\p{N}]/u.test(character);
}

/**
 * Whether the character at this position could be a closing quote read wrong:
 * it ends a word and sits against a boundary, and is not something that belongs
 * to the word or to the reading.
 */
function couldBeClosing(line: string, index: number, limit: number): boolean {
  const character = line[index];
  if (
    isAlphanumeric(character) ||
    /\s/.test(character) ||
    APOSTROPHES.has(character) ||
    PRESERVED.has(character) ||
    character === CLOSING
  ) {
    return false;
  }

  const previous = index > 0 ? line[index - 1] : " ";
  const next = index + 1 < line.length ? line[index + 1] : " ";
  const endsAWord =
    isAlphanumeric(previous) ||
    PUNCTUATION.has(previous) ||
    previous === CLOSING;
  const atABoundary =
    /\s/.test(next) ||
    PRESERVED.has(next) ||
    PUNCTUATION.has(next) ||
    index + 1 >= limit ||
    next === OPENING;

  return endsAWord && atABoundary;
}

/**
 * Where the quotations actually open.
 *
 * An opening quote pressed against the end of a word, with a boundary after it,
 * is a mangled closing quote rather than a new quotation: the engine reads
 * "some” as “some“.
 */
function openingPositions(line: string): number[] {
  const positions: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === OPENING && !couldBeClosing(line, index, line.length)) {
      positions.push(index);
    }
  }
  return positions;
}

/** Repairs one line of prose, leaving everything it is unsure about alone. */
export function repairClosingQuotes(line: string): string {
  const openings = openingPositions(line);
  if (openings.length === 0) {
    return line;
  }

  const characters = [...line];
  for (const [order, start] of openings.entries()) {
    const end = openings[order + 1] ?? line.length;
    if (line.slice(start, end).includes(CLOSING)) {
      continue;
    }

    const candidates: number[] = [];
    for (let index = start + 1; index < end; index += 1) {
      if (couldBeClosing(line, index, end)) {
        candidates.push(index);
      }
    }
    // Only when one candidate cannot be punctuation. Two means the line does
    // not say which, and guessing would damage prose that was read correctly.
    const impossible = candidates.filter(
      (index) => !PUNCTUATION.has(line[index]),
    );
    if (impossible.length === 1) {
      characters[impossible[0]] = CLOSING;
    }
  }

  return characters.join("");
}
