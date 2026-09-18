import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PREFERRED_MIME_TYPES, chooseMimeType } from "./recorder.ts";

/**
 * Support lists shaped like the ones browsers report. They are written out by
 * hand rather than measured, because the point of these cases is the shape of
 * the answer, not the exact roster of any one browser version: a list with Opus
 * in it, a list with only AAC, a list with neither.
 */
const WEBM_AND_OGG = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];
const AAC_ONLY = ["audio/mp4", "audio/mp4;codecs=mp4a.40.2"];
const NOTHING_USABLE = ["audio/aac", "audio/flac", "audio/wav"];

describe("chooseMimeType", () => {
  test("prefers Opus in WebM when the browser offers everything", () => {
    assert.equal(
      chooseMimeType([...PREFERRED_MIME_TYPES]),
      "audio/webm;codecs=opus",
    );
  });

  test("takes Opus in WebM over the other WebM and Ogg types", () => {
    assert.equal(chooseMimeType(WEBM_AND_OGG), "audio/webm;codecs=opus");
  });

  test("asks for the spelled out AAC codec before the bare mp4", () => {
    assert.equal(chooseMimeType(AAC_ONLY), "audio/mp4;codecs=mp4a.40.2");
    assert.equal(chooseMimeType(["audio/mp4"]), "audio/mp4");
  });

  /*
   * The order of the argument must not decide the answer. A browser is free to
   * report its types in any order, and if that leaked through, the choice would
   * follow the browser instead of our preference, which is exactly the bug this
   * function exists to prevent.
   */
  test("follows our preference, not the order the browser listed", () => {
    const reversed = [...PREFERRED_MIME_TYPES].reverse();
    assert.equal(chooseMimeType(reversed), "audio/webm;codecs=opus");
    assert.equal(
      chooseMimeType(["audio/ogg;codecs=opus", "audio/mp4", "audio/webm"]),
      "audio/webm",
    );
  });

  test("ignores types that are not on the preference list", () => {
    const withNoise = ["audio/aac", "audio/3gpp", "video/webm", "audio/mp4"];
    assert.equal(chooseMimeType(withNoise), "audio/mp4");
  });

  /*
   * Matching is case insensitive and tolerant of the space after the semicolon,
   * since browsers differ on both. The string that comes back is the caller's
   * own spelling: that is what the browser said it supports, so that is what
   * MediaRecorder should be handed.
   */
  test("matches a differently spelled type and hands back that spelling", () => {
    assert.equal(
      chooseMimeType(["AUDIO/WEBM; codecs=opus"]),
      "AUDIO/WEBM; codecs=opus",
    );
    assert.equal(chooseMimeType(["  audio/mp4  "]), "  audio/mp4  ");
  });

  test("keeps the first spelling when one type is listed twice", () => {
    assert.equal(
      chooseMimeType(["audio/webm; codecs=opus", "audio/webm;codecs=opus"]),
      "audio/webm; codecs=opus",
    );
  });

  /*
   * audio/wav is in this list on purpose. It is a real audio type that a
   * browser could name, and it is deliberately not on our preference list,
   * so choosing it would be a regression rather than a lucky fallback.
   */
  test("returns null when nothing on the preference list is supported", () => {
    assert.equal(chooseMimeType([]), null);
    assert.equal(chooseMimeType(NOTHING_USABLE), null);
  });
});
