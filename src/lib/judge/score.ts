/**
 * How a judgement is scored against the case. Pure, so the rules can be shown
 * failing when they should.
 */

import { normalize } from "../stt/score.ts";
import { differingMiddle } from "./expected.ts";
import type { Difference, Judgement } from "./provider.ts";

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
 * A dropped difference is one whose two sides are the same once normalised,
 * an empty side counting as nothing. So the same word on both sides goes,
 * and so does a one-sided difference that is only punctuation: on
 * 2026-09-25 gpt-audio-1.5 listed the "..." of h02's expected answer as a
 * missing word. A missing or an extra word always stays, because a word
 * against nothing is a difference.
 */
export function substantiveDifferences(
  differences: readonly Difference[],
): Difference[] {
  return differences.filter(
    (difference) =>
      normalize(difference.expected ?? "") !== normalize(difference.said ?? ""),
  );
}

export type Verdict = "match" | "mismatch" | "uncertain";

/**
 * Where the fields of a judgement disagree with each other, counting only
 * substantive differences, or null when they agree.
 */
function fieldsContradict(
  judgement: Judgement,
  substantive: number,
): string | null {
  if (judgement.matches && substantive > 0) {
    return "matches but lists differences";
  }
  if (judgement.englishSpeech && judgement.noEnglishReason !== null) {
    return "English speech with a reason for none";
  }
  if (!judgement.englishSpeech && judgement.noEnglishReason === null) {
    return "no English speech and no reason";
  }
  if (!judgement.englishSpeech && judgement.matches) {
    return "matches with no English speech";
  }
  return null;
}

/**
 * The verdict the tutor acts on, recounted from the judgement.
 *
 *   match      English speech, and no substantive difference left.
 *   mismatch   at least one substantive difference left.
 *   uncertain  the model says it does not match and names nothing
 *              substantive, or the fields contradict each other.
 *
 * No English speech is never a match, whatever else the answer says.
 * Uncertain is never an acceptance: in the tutor it becomes "Again, please".
 *
 * Why three and not two. The two-way recount of 2026-09-25 turned "does not
 * match, and no difference named" into a match: gpt-audio-1.5 answered h02 #2
 * that way, and m01 with no English speech and no difference, and both came
 * out as "bate". So did g08 re-recorded, where the only difference named was
 * "closed." against "closed": the model had heard "closed" and refused for
 * punctuation. A verdict the model did not give and the differences do not
 * support is not a verdict to accept on.
 */
export function recountedVerdict(judgement: Judgement): Verdict {
  const substantive = substantiveDifferences(judgement.differences).length;
  if (fieldsContradict(judgement, substantive) !== null) return "uncertain";
  if (substantive > 0) return "mismatch";
  if (!judgement.englishSpeech) return "uncertain";
  if (!judgement.matches) return "uncertain";
  return "match";
}
