import type { BlockKind } from "./classify.ts";
import { COLUMN_SEPARATOR } from "./grammar-table.ts";

/**
 * The characters a page of these books may contain.
 *
 * The engine returns shapes that are not English: a "|" standing in for an "I",
 * a "*" glued to a word, a table's bracket arriving as a token of its own. None
 * of them is a spelling mistake, and none is visible to a reader skimming a
 * block that otherwise looks fine. What they have in common is that the book
 * cannot print them, so a block holding one is a block the extraction got
 * wrong somewhere, whatever else it got right.
 *
 * Measured before it was written, with scripts/measure-impossible-characters.ts,
 * over the 361 blocks the pipeline produces from the 92 pages of both books.
 *
 * A first pass allowed only letters, digits, the quotes, and " ,.?/-()". It
 * flagged 36 blocks and 22 of them were correct English, because seven of the
 * twelve characters it turned up are the book's own. Those seven are in the set
 * below, each with the line of the book that proves it:
 *
 *   ";"  19 times, 14 blocks: "we aren't both sitting; you're sitting"
 *   "—"  10 times,  7 blocks: "Before a consonant we say “a” — a book"
 *   "!"   4 times,  2 blocks: the imperative lesson, "take!, put!, open!"
 *   ":"   4 times,  3 blocks: "five vowels in the English alphabet:"
 *   "="   3 times,  3 blocks: the vocabulary entry "no = not any"
 *   "+"   1 time,   1 block:  the arithmetic lesson, "2 + 2 = 4"
 *   "‘"   1 time,   1 block:  an opening single quote
 *
 * With those admitted, the set flags 21 blocks of 361, which is 6%: 3 of them
 * already reach the teacher flagged for being tall, so 18 are marking this rule
 * adds. By kind: 11 explanations, 4 dictations, 3 vocabulary panels. What it
 * flags them for is five characters, and every one is an artefact:
 *
 *   "|"  18 times, 14 blocks
 *   "~"   3 times,  3 blocks
 *   "]"   3 times,  3 blocks
 *   "*"   1 time,   1 block
 *   "&"   1 time,   1 block
 *
 * 6% is the number that makes the rule worth having. A rule that flagged most
 * of the corpus would not be a rule, it would be noise with a threshold; one
 * flagging 18 blocks in 92 pages is a morning's work and catches every artefact
 * measured.
 *
 * Deliberately no wider than the pages proved. A character nobody has seen in
 * these books is flagged rather than quietly allowed, which is what lets the
 * next measurement say the set is wrong.
 */
const LEGITIMATE: ReadonlySet<string> = new Set([
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  // Apostrophes and quotes in both the typewriter and the typographic shapes:
  // the engine returns "don’t" with U+2019 and the book prints it that way.
  ..."'’\"“”‘",
  // Comma, full stop, question mark, the dictation's slash, hyphen, brackets.
  ..." ,.?/-()",
  // The seven the pages proved: semicolon, colon, em dash, exclamation,
  // equals, plus. See the count beside each above.
  ...";:—!=+",
  // The line break `serializeTable` writes a table's rows with.
  "\n",
]);

/**
 * Whether this block holds a character the book cannot print.
 *
 * The same mechanism as the height flag on a tall panel: it does not correct
 * anything and does not claim to know what the right character was. It says the
 * extraction has an artefact in it and puts the block in front of the teacher,
 * which is the only honest thing to do about a shape nobody can map back.
 *
 * @param kind because inside a grammar_table the "|" is `serializeTable` doing
 *   its job, not the engine's mistake. Counting it would flag every table in
 *   both books and drown the signal.
 */
export function hasImpossibleCharacter(
  content: string,
  kind: BlockKind,
): boolean {
  for (const character of content) {
    if (LEGITIMATE.has(character)) {
      continue;
    }
    if (kind === "grammar_table" && character === COLUMN_SEPARATOR) {
      continue;
    }
    return true;
  }
  return false;
}
