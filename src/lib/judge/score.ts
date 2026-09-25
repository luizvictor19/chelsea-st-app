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
