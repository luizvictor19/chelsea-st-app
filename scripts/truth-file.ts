import { readFileSync } from "node:fs";

/**
 * The numbers a book's pages actually carry, read off the images by hand.
 *
 * Kept separate from anything the extractor produces. A measurement scored
 * against the extractor's own earlier output only proves that nothing changed;
 * scoring it against a page someone read with their eyes is what can say the
 * extractor is wrong.
 *
 * Two formats, because the two books arrived with different ones and neither is
 * worth rewriting: `truth.txt`, one line per page as `file | points | notes`,
 * and the `manifest.json` that shipped with book 2, whose `pages_detail` was
 * checked against the pages by hand in the same way.
 */
export type TruthPage = {
  readonly file: string;
  /** The numbers printed in the margin, in the order they are printed. */
  readonly points: readonly number[];
  /** `lesson=3`, `dictation=1`, and the like, as written in the file. */
  readonly notes: string;
};

/** `Screenshot ... .png | 4 5 | lesson=2`, `# comment`, or `... | cont`. */
function parseTruthText(text: string): readonly TruthPage[] {
  const pages: TruthPage[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const [file, points = "", notes = ""] = trimmed.split("|");
    pages.push({
      file: file.trim(),
      // `cont` is a page with no number of its own, which is an empty list and
      // not a missing entry: the page exists and the extractor must see it.
      points: points
        .trim()
        .split(/\s+/)
        .filter((token) => /^\d+$/.test(token))
        .map(Number),
      notes: notes.trim(),
    });
  }
  return pages;
}

type Manifest = {
  readonly pages_detail: readonly { file: string; points: number[] }[];
};

export function readTruth(path: string): readonly TruthPage[] {
  const text = readFileSync(path, "utf8");
  if (!path.endsWith(".json")) {
    return parseTruthText(text);
  }
  const manifest = JSON.parse(text) as Manifest;
  return manifest.pages_detail.map((page) => ({
    file: page.file,
    points: page.points,
    notes: "",
  }));
}
