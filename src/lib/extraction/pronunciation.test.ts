import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stripTranscriptions } from "./pronunciation.ts";

describe("stripTranscriptions", () => {
  test("the pair of terms from point 38 both become the word", () => {
    // The book prints "a  an  the /ðə/  the /ðiː/". The engine does not read
    // IPA, so the transcription arrives as rubbish welded onto a term that
    // would otherwise be right, and both of those terms are "the".
    assert.deepEqual(stripTranscriptions(["a", "an", "the /0a/", "the /0i/"]), {
      terms: ["a", "an", "the", "the"],
      amended: true,
    });
  });

  test("a panel with no transcription is left exactly as it came", () => {
    const terms = ["on", "under", "in"];
    const result = stripTranscriptions(terms);
    assert.deepEqual(result.terms, terms);
    assert.equal(result.amended, false);
  });

  test("a term that is nothing but a transcription does not vanish", () => {
    // Removing it would leave a hole where a term was, and a hole is the one
    // thing the teacher cannot see. It keeps the term and asks to be looked at.
    assert.deepEqual(stripTranscriptions(["/0a/"]), {
      terms: ["/0a/"],
      amended: true,
    });
  });

  test("one slash is not a transcription", () => {
    // The book writes "and/or" and the like, and a lone slash closes nothing.
    const terms = ["and/or"];
    assert.deepEqual(stripTranscriptions(terms), { terms, amended: false });
  });

  test("what is left of the term is tidied, not just cut", () => {
    assert.deepEqual(stripTranscriptions(["the  /0a/  word"]), {
      terms: ["the word"],
      amended: true,
    });
  });

  test("nothing to do with an empty panel", () => {
    assert.deepEqual(stripTranscriptions([]), { terms: [], amended: false });
  });
});
