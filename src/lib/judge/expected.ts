/**
 * The answer a case expects, built from what was said. Pure, so the one rule
 * that matters (the error case expects the corrected sentence) can be shown
 * working on every case in the file.
 *
 * The result is written into scripts/stt-cases.json as `expected`, and a test
 * holds the file to this function, so the file cannot drift from the rule.
 */

/** A token split into its punctuation and the word between them. */
type Token = { lead: string; core: string; trail: string };

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .filter((raw) => raw !== "")
    .map((raw) => {
      const match = /^([^\p{L}\p{N}']*)(.*?)([^\p{L}\p{N}']*)$/u.exec(raw);
      return match === null
        ? { lead: "", core: raw, trail: "" }
        : { lead: match[1], core: match[2], trail: match[3] };
    });
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
}

/**
 * The part of the two spans that differs: the words they share at the start
 * and at the end are context, not the error. `start` is how many words they
 * share at the start.
 *
 * "brown stand in" against "brown stands in" differs in one word, "stand"
 * against "stands". "is pen" against "is a pen" differs by an insertion: an
 * empty middle on the error side, "a" on the corrected side.
 */
export function differingMiddle(
  errorSpan: string,
  correctedSpan: string,
): { start: number; said: string[]; expected: string[] } {
  const error = words(errorSpan);
  const corrected = words(correctedSpan);
  let start = 0;
  while (
    start < error.length &&
    start < corrected.length &&
    error[start] === corrected[start]
  ) {
    start++;
  }
  let end = 0;
  while (
    end < error.length - start &&
    end < corrected.length - start &&
    error[error.length - 1 - end] === corrected[corrected.length - 1 - end]
  ) {
    end++;
  }
  return {
    start,
    said: error.slice(start, error.length - end),
    expected: corrected.slice(start, corrected.length - end),
  };
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * `spoken` with `errorSpan` replaced by `correctedSpan`.
 *
 * Only the words that differ are replaced, so the rest keeps the spelling it
 * had in `spoken`: "Mr Brown stand in" becomes "Mr Brown stands in", and the
 * capital B the span did not carry survives. A replaced word that began the
 * sentence with a capital passes the capital on ("Have a clock" becomes
 * "There is a clock"), and punctuation stuck to a replaced word stays where
 * it was ("is close." becomes "is closed.").
 *
 * Throws when the span is not in the sentence as whole words: an error case
 * whose error cannot be found is a broken case, not one to guess at.
 */
export function correctSpoken(
  spoken: string,
  errorSpan: string,
  correctedSpan: string,
): string {
  const tokens = tokenize(spoken);
  const cores = tokens.map((token) => token.core.toLowerCase());
  const span = words(errorSpan);

  let at = -1;
  for (let i = 0; i + span.length <= cores.length; i++) {
    if (span.every((word, offset) => cores[i + offset] === word)) {
      at = i;
      break;
    }
  }
  if (at < 0) {
    throw new Error(`"${errorSpan}" is not in "${spoken}" as whole words`);
  }

  const middle = differingMiddle(errorSpan, correctedSpan);
  const from = at + middle.start;
  const replaced = tokens.slice(from, from + middle.said.length);
  const inserted = middle.expected.map((core) => ({
    lead: "",
    core,
    trail: "",
  }));

  if (replaced.length > 0 && inserted.length > 0) {
    inserted[0].lead = replaced[0].lead;
    inserted[inserted.length - 1].trail = replaced[replaced.length - 1].trail;
    const first = replaced[0].core;
    if (first.charAt(0) !== first.charAt(0).toLowerCase()) {
      inserted[0].core = capitalise(inserted[0].core);
    }
  } else if (replaced.length > 0) {
    // A pure deletion: the punctuation of what went must not go with it.
    const before = tokens[from - 1];
    if (before !== undefined) {
      before.trail += replaced[replaced.length - 1].trail;
    }
  }

  const result = [
    ...tokens.slice(0, from),
    ...inserted,
    ...tokens.slice(from + middle.said.length),
  ];
  return result.map((token) => token.lead + token.core + token.trail).join(" ");
}

/**
 * What a case expects, for the categories where it follows from the case:
 * the sentence as said when it was right, the corrected sentence when it had
 * a mistake. Null for the categories whose expectation is a judgement about
 * the recording (silence, noise, Portuguese), which live in the file by hand.
 */
export function derivedExpected(each: {
  category: string;
  spoken: string;
  errorSpan?: string;
  correctedSpan?: string;
}): string | null {
  if (each.category === "grammar_error") {
    if (each.errorSpan === undefined || each.correctedSpan === undefined) {
      throw new Error("A grammar_error needs errorSpan and correctedSpan");
    }
    return correctSpoken(each.spoken, each.errorSpan, each.correctedSpan);
  }
  if (
    each.category === "correct" ||
    each.category === "pronunciation" ||
    each.category === "hesitation"
  ) {
    return each.spoken;
  }
  return null;
}
