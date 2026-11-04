import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { safeNextPath, safeNextUrl } from "./safe-redirect.ts";

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

/*
 * #102. Outside Vercel, Next builds the request URL from the server's
 * hostname, not from the Host header, so a link opened at 127.0.0.1 arrives
 * with nextUrl.origin saying localhost. An absolute redirect built on that
 * origin sent the browser to another host, where the session cookie just set
 * did not exist.
 *
 * safeNextPath returns a path for a relative Location, which the browser
 * resolves against the address the link was opened at. Each test resolves
 * the result the way the browser does, against LINK, and checks the host.
 */
const NEXT_SAYS = "http://localhost:3000";
const LINK = "http://127.0.0.1:3000/auth/callback?token_hash=x&type=email";
const LINK_ORIGIN = new URL(LINK).origin;

/** Where the browser lands, given the Location the route sent. */
function landing(location: string): URL {
  return new URL(location, LINK);
}

describe("safeNextPath", () => {
  test("a link opened at 127.0.0.1 lands on 127.0.0.1, whatever Next calls the origin", () => {
    const result = landing(safeNextPath("/teacher", NEXT_SAYS));
    assert.equal(result.origin, LINK_ORIGIN);
    assert.equal(result.pathname, "/teacher");
  });

  test("no entry of the hostile list leaves the host the link was opened at", () => {
    for (const raw of HOSTILE) {
      for (const origin of [ORIGIN, NEXT_SAYS]) {
        const location = safeNextPath(raw, origin);
        assert.equal(
          landing(location).origin,
          LINK_ORIGIN,
          `${JSON.stringify(raw)} on ${origin} escaped through ${JSON.stringify(location)}`,
        );
      }
    }
  });

  /*
   * safeNextUrl keeps "/..//evil.com" as our host with the path "//evil.com".
   * As a relative Location that path is a scheme-relative URL, another host,
   * so the path is refused and the root is the answer.
   */
  test('"/..//evil.com" goes to the root', () => {
    assert.equal(safeNextPath("/..//evil.com", ORIGIN), "/");
  });

  test("never returns a Location that starts with two slashes or a backslash", () => {
    for (const raw of HOSTILE) {
      const location = safeNextPath(raw, ORIGIN);
      assert.match(location, /^\/(?![/\\])/, JSON.stringify(raw));
    }
  });

  test("keeps the search and the hash", () => {
    assert.equal(
      safeNextPath("/dashboard?from=email#top", ORIGIN),
      "/dashboard?from=email#top",
    );
    assert.equal(safeNextPath("/set-password", ORIGIN), "/set-password");
  });

  test("an absolute URL on the origin Next names becomes its path", () => {
    assert.equal(safeNextPath(`${ORIGIN}/teacher`, ORIGIN), "/teacher");
  });

  test("missing, empty or unparseable input goes to the root", () => {
    assert.equal(safeNextPath(null, ORIGIN), "/");
    assert.equal(safeNextPath("", ORIGIN), "/");
    assert.equal(safeNextPath("http://[", ORIGIN), "/");
  });
});
