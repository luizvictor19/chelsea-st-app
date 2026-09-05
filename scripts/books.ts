/**
 * Where each book's pages live, and how a script is told which one to read.
 *
 * The directory is per book rather than one folder of "the real pages", and
 * that is not tidiness. A book's range is what validates a margin reading:
 * `reconcilePoints` throws away anything below the book's first point and above
 * its last, so a stray `3` is noise in book 2, whose points run 53 to 128, and
 * a real point number in book 1, whose points run 1 to 52. Measured over a
 * directory holding both, every threshold would describe a population that is
 * not any book.
 *
 * The pages themselves never enter the repository. These are the paths they are
 * expected at when a local tool is run.
 */
export const BOOK_1 = "fixtures/real/book1";
export const BOOK_2 = "fixtures/real/book2";

/**
 * `--fixtures DIR`, defaulting to book 2.
 *
 * Book 2 is the default because every threshold in `constants.ts` was measured
 * against it and the numbers recorded in `docs/spec-ingestao.md` are what these
 * scripts have to keep reproducing. Pointing one at book 1 is a new
 * measurement, and saying so on the command line is the point.
 */
export function fixturesOption(argv: readonly string[] = process.argv): string {
  const at = argv.indexOf("--fixtures");
  return at < 0 ? BOOK_2 : argv[at + 1];
}
