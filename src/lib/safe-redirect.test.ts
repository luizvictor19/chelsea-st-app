import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { safeNextUrl } from "./safe-redirect.ts";

const ORIGIN = "https://app.chelsea.example";

/**
 * Every one of these was reachable through the `next` parameter of the auth
 * callback, which redirects someone the instant they have been signed in.
 *
 * The first two are the reason a deny list does not work here: the WHATWG
 * parser turns a backslash into a slash for special schemes, so "/\evil.com"
 * becomes "//evil.com" and leaves the site. Nothing about the raw string looks
 * like an absolute URL.
 */
const HOSTILE = [
  "/\\evil.com",
  "/\\/evil.com",
  "/..//evil.com",
  "//evil.com",
  "https://evil.com",
  "https://origem-legitima.evil.com",
  // Our origin as a prefix of theirs, which is what a startsWith check misses.
  `${ORIGIN}.evil.com`,
  "\\\\evil.com",
  "https:evil.com",
];

describe("safeNextUrl", () => {
  test("never returns a URL pointing off our origin", () => {
    for (const raw of HOSTILE) {
      const result = safeNextUrl(raw, ORIGIN);
      assert.equal(
        result.origin,
        ORIGIN,
        `${JSON.stringify(raw)} escaped to ${result.href}`,
      );
    }
  });

  test("falls back to the root for anything that resolves elsewhere", () => {
    const escaping = [
      "/\\evil.com",
      "/\\/evil.com",
      "//evil.com",
      "https://evil.com",
      "https://origem-legitima.evil.com",
      `${ORIGIN}.evil.com`,
    ];
    for (const raw of escaping) {
      assert.equal(
        safeNextUrl(raw, ORIGIN).href,
        `${ORIGIN}/`,
        `${JSON.stringify(raw)} should have fallen back`,
      );
    }
  });

  test("a path that stays on our origin is kept, however odd it looks", () => {
    // Resolves to our host with the path "//evil.com", which is ours to serve.
    assert.equal(
      safeNextUrl("/..//evil.com", ORIGIN).href,
      `${ORIGIN}//evil.com`,
    );
  });

  test("keeps ordinary destinations intact", () => {
    assert.equal(safeNextUrl("/dashboard", ORIGIN).href, `${ORIGIN}/dashboard`);
    assert.equal(
      safeNextUrl("/dashboard?from=email#top", ORIGIN).href,
      `${ORIGIN}/dashboard?from=email#top`,
    );
  });

  test("an absolute URL on our own origin is allowed", () => {
    assert.equal(
      safeNextUrl(`${ORIGIN}/teacher`, ORIGIN).href,
      `${ORIGIN}/teacher`,
    );
  });

  test("missing or unparseable input falls back to the root", () => {
    assert.equal(safeNextUrl(null, ORIGIN).href, `${ORIGIN}/`);
    assert.equal(safeNextUrl("", ORIGIN).href, `${ORIGIN}/`);
    assert.equal(safeNextUrl("http://[", ORIGIN).href, `${ORIGIN}/`);
  });
});
