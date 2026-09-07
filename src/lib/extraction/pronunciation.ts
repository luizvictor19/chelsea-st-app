/**
 * Takes the pronunciation out of a vocabulary term.
 *
 * The book prints a word beside how it is said, between slashes, in IPA:
 *
 *   a    an    the /ðə/    the /ðiː/
 *
 * This engine has no IPA in it. The transcription comes back as rubbish
 * whatever happens, and it comes back welded onto a term that would otherwise
 * be right: point 38 of book 1 yields the terms "a", "an", "the /0a/" and
 * "the /0i/", and both of the last two are the word "the".
 *
 * A term is what the sentence generator is later allowed to use, so a term
 * carrying rubbish is rubbish in a lesson. The transcription goes; the word
 * stays.
 *
 * Measured before it was written, with scripts/measure-slashed-terms.ts, over
 * the 253 vocabulary panels and 606 terms of both books. Two terms hold a run
 * between slashes, and they are the two above: every slashed run in a term in
 * these books is a transcription, and there is no second kind for the rule to
 * get wrong.
 *
 * The panel is flagged when anything is taken out, and that is the point of
 * doing it here rather than quietly. The two terms both become "the", and a
 * term repeated inside one panel always means something: the book is pairing
 * one spelling with two pronunciations. What to do with the duplicate is the
 * teacher's, on the review screen, and the flag is what puts it in front of
 * them.
 *
 * Vocabulary panels only, and the caller is what keeps it there. On a dictation
 * page the slash is the reading pause and is the content: the 9 dictation
 * blocks of these books hold 197 of them, and a rule that wandered in there
 * would delete what the page is for.
 */

/**
 * A run between two slashes, with something in it.
 *
 * Both slashes required, because a lone one is ordinary: the book writes
 * "and/or". Anything at all between them, because a transcription the engine
 * mangled beyond recognition is still a transcription, and a tighter pattern
 * would only catch the ones that came out well.
 */
const TRANSCRIPTION = /\/[^/]+\//g;

/**
 * How many slashes a term may hold before this refuses to read any of them.
 *
 * "Both slashes required" answers one lone slash and not two. A term reading
 * "and/or he/she" holds two, the pattern pairs the inner ones, and the term is
 * silently rewritten to "and she": a shape the book never printed, arrived at
 * by a rule that was supposed to be removing rubbish. Neither book contains
 * such a term today, so this closes a door rather than mending a break, and it
 * closes it the safe way round: a term it refuses keeps everything it had.
 */
const MOST_SLASHES = 2;

export type StrippedTerms = {
  readonly terms: readonly string[];
  /** Whether anything was taken out, which is what flags the panel. */
  readonly amended: boolean;
};

export function stripTranscriptions(terms: readonly string[]): StrippedTerms {
  let amended = false;
  const stripped = terms.map((term) => {
    if ((term.match(/\//g) ?? []).length > MOST_SLASHES) {
      return term;
    }
    // Against the term with the run cut out and nothing else, so that tidying
    // the space left behind cannot on its own claim something was removed. The
    // flag means "the reader changed this", and a panel is put in front of the
    // teacher on the strength of it.
    const cut = term.replace(TRANSCRIPTION, " ");
    if (cut === term) {
      return term;
    }
    amended = true;
    const without = cut.replace(/\s+/g, " ").trim();
    // A term that was nothing but a transcription keeps what it had. An empty
    // term is a hole where a column was, and a hole is the one thing the
    // teacher cannot see on the screen; the flag brings them to it instead.
    return without === "" ? term : without;
  });
  return { terms: amended ? stripped : terms, amended };
}
