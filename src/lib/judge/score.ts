/**
 * How a judgement is scored against the case. Pure, so the rules can be shown
 * failing when they should.
 */

import { normalize } from "../stt/score.ts";
import { differingMiddle } from "./expected.ts";
import type { Difference } from "./provider.ts";

function wordsOf(values: readonly (string | null)[]): string[] {
  return values.flatMap((value) =>
    value === null
      ? []
      : normalize(value)
          .split(" ")
          .filter((w) => w !== ""),
  );
}

/**
 * Whether the differences point at the mistake, and whether at nothing else.
 *
 * The mistake is the part of errorSpan that differs from correctedSpan: for
 * "brown stand in" against "brown stands in", "stand" said where "stands" was
 * expected. `pointed` means every word the student got wrong appears among
 * the words the differences say were said, and every word the answer needed
 * appears among the words they say were expected. How the model splits it
 * does not matter ("more long" for "longer" may come back as one replacement
 * or as a replacement and an extra word); that the words are named does.
 *
 * `onlyError` is stricter: pointed, and no difference names a word outside
 * the mistake. A judge that flags the mistake and also three words that were
 * fine would have the tutor correct things the student got right.
 */
export function differencesPointAtError(
  differences: readonly Difference[],
  errorSpan: string,
  correctedSpan: string,
): { pointed: boolean; onlyError: boolean } {
  const middle = differingMiddle(errorSpan, correctedSpan);
  const saidWrong = new Set(wordsOf(middle.said));
  const neededRight = new Set(wordsOf(middle.expected));

  const namedSaid = new Set(wordsOf(differences.map((d) => d.said)));
  const namedExpected = new Set(wordsOf(differences.map((d) => d.expected)));

  const pointed =
    differences.length > 0 &&
    [...saidWrong].every((word) => namedSaid.has(word)) &&
    [...neededRight].every((word) => namedExpected.has(word));

  const onlyError =
    pointed &&
    [...namedSaid].every((word) => saidWrong.has(word)) &&
    [...namedExpected].every((word) => neededRight.has(word));

  return { pointed, onlyError };
}

/**
 * The differences that are differences: those where the two sides are not
 * the same word once normalised (case and punctuation gone, contractions
 * kept, as the transcription report compares).
 *
 * Why this exists. Measured on 2026-09-25, gpt-audio-1.5 refused 19 of 24
 * right answers by its own verdict, and every one of those refusals was a
 * "difference" of punctuation or capitals ("Yes," against "Yes", "table."
 * against "table", "The" against "The"), although the prompt tells it to
 * ignore both. Its heard matched what was said in 24 of 24. gpt-audio-mini
 * does the same in another shape: right words listed as missing, with the
 * same word said. Dropping these is not a repair of the answer, which is
 * stored as it came; it is the reading the report makes of it.
 *
 * A dropped difference is one the model named on both sides with the same
 * word. A missing word (said null) or an extra one (expected null) is never
 * dropped, because one side is empty.
 */
export function substantiveDifferences(
  differences: readonly Difference[],
): Difference[] {
  return differences.filter((difference) => {
    if (difference.expected === null || difference.said === null) return true;
    return normalize(difference.expected) !== normalize(difference.said);
  });
}

/**
 * The verdict recounted from the differences: it matches when no substantive
 * difference is left. The model's own `matches` is ignored here on purpose,
 * because it is the field the punctuation noise flips; the report prints both
 * so the two can be compared.
 */
export function recountedMatch(differences: readonly Difference[]): boolean {
  return substantiveDifferences(differences).length === 0;
}
