/**
 * Resolves the `next` parameter into a URL that is guaranteed to be on our own
 * origin, falling back to the root when it is not.
 *
 * Validates the result rather than the input. A deny list cannot work here: the
 * WHATWG parser rewrites a backslash as a slash for special schemes, so
 * "/\evil.com" resolves to "//evil.com" and leaves the site while looking like
 * an ordinary relative path. Any list of forbidden shapes is a list of the
 * tricks that were thought of.
 *
 * Returns the resolved URL rather than a path, so the caller never parses it a
 * second time. That matters: "/..//evil.com" resolves onto our origin with the
 * path "//evil.com", and feeding that pathname back through the parser would
 * turn it into another host.
 */
export function safeNextUrl(raw: string | null, origin: string): URL {
  const fallback = new URL("/", origin);
  if (!raw) {
    return fallback;
  }

  let candidate: URL;
  try {
    candidate = new URL(raw, origin);
  } catch {
    return fallback;
  }

  // Compared whole, never by prefix: "https://ours.example.evil.com" starts
  // with our origin and belongs to somebody else.
  return candidate.origin === origin ? candidate : fallback;
}

/**
 * The same destination as safeNextUrl, as a path for a relative Location.
 *
 * Outside Vercel, Next builds the request URL from the server's hostname and
 * not from the Host header, so a link opened at 127.0.0.1 is told its origin
 * is localhost (#102). An absolute redirect built on that origin takes the
 * browser to another host, where the session cookie just set does not exist.
 * A relative Location is resolved by the browser against the address it is
 * on, so the session and the destination stay on one host. The origin is
 * still the base the destination is validated against, and nothing more.
 *
 * A path is not always safe as a Location: one that starts with "//" is a
 * scheme-relative URL, another host, and one that starts with "/\" is read
 * the same way by browsers. safeNextUrl keeps "/..//evil.com" on our origin
 * with the path "//evil.com", which is fine as a URL and an open redirect as
 * a Location. Those go to the root, like every other hostile input.
 */
export function safeNextPath(raw: string | null, origin: string): string {
  const url = safeNextUrl(raw, origin);
  const path = url.pathname + url.search + url.hash;
  return /^\/[/\\]/.test(path) ? "/" : path;
}
