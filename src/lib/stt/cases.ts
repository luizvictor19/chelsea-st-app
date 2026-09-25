/**
 * The cases the transcribers are measured on. The list lives in
 * scripts/stt-cases.json, which is committed; the recordings of it do not,
 * they are Luiz's voice and live under fixtures/stt.
 *
 * Read from disk and checked here rather than imported, because both the
 * Next server and plain node scripts load it, and node will not import JSON
 * without an attribute Next does not need.
 */

export const STT_CATEGORIES = [
  "correct",
  "grammar_error",
  "pronunciation",
  "hesitation",
  "mixed_portuguese",
  "silence_noise",
] as const;

export type SttCategory = (typeof STT_CATEGORIES)[number];

export type SttCase = {
  readonly id: string;
  readonly category: SttCategory;
  /** What the tutor asked, for context on the recording screen. */
  readonly question: string;
  /**
   * What Luiz says, exactly, mistakes included. Empty for a case with no
   * speech at all, which is also what a faithful transcriber returns.
   */
  readonly spoken: string;
  /** How to say it, when the words alone do not: an accent, background noise. */
  readonly direction?: string;
  /** grammar_error only: the part that must survive as it was said. */
  readonly errorSpan?: string;
  /** grammar_error only: what a transcriber that corrects would write. */
  readonly correctedSpan?: string;
};

/** Safe as a filename: the id becomes fixtures/stt/<id>.webm. */
const ID = /^[a-z][0-9]{2}$/;

function isCategory(value: unknown): value is SttCategory {
  return STT_CATEGORIES.some((category) => category === value);
}

/**
 * The cases, or an exception that names the first thing wrong. A bad file is
 * refused whole: a measurement over half a list is a different measurement.
 */
export function parseCases(raw: unknown): SttCase[] {
  if (!Array.isArray(raw)) throw new Error("STT cases: expected an array");
  const seen = new Set<string>();

  return raw.map((item, index) => {
    const where = `STT case ${index}`;
    if (typeof item !== "object" || item === null) {
      throw new Error(`${where}: not an object`);
    }
    const value = item as Record<string, unknown>;
    const { id, category, question, spoken, direction } = value;
    const { errorSpan, correctedSpan } = value;

    if (typeof id !== "string" || !ID.test(id)) {
      throw new Error(`${where}: id must look like g01`);
    }
    if (seen.has(id)) throw new Error(`${where}: duplicate id ${id}`);
    seen.add(id);
    if (!isCategory(category)) {
      throw new Error(`${id}: unknown category ${String(category)}`);
    }
    if (typeof question !== "string" || question === "") {
      throw new Error(`${id}: question is required`);
    }
    if (typeof spoken !== "string") {
      throw new Error(`${id}: spoken must be a string`);
    }
    if (direction !== undefined && typeof direction !== "string") {
      throw new Error(`${id}: direction must be a string`);
    }

    const isError = category === "grammar_error";
    const hasSpans =
      typeof errorSpan === "string" &&
      errorSpan !== "" &&
      typeof correctedSpan === "string" &&
      correctedSpan !== "";
    if (isError !== hasSpans) {
      throw new Error(
        isError
          ? `${id}: a grammar_error needs errorSpan and correctedSpan`
          : `${id}: only a grammar_error carries spans`,
      );
    }

    return {
      id,
      category,
      question,
      spoken,
      ...(typeof direction === "string" ? { direction } : {}),
      ...(hasSpans ? { errorSpan, correctedSpan } : {}),
    };
  });
}
