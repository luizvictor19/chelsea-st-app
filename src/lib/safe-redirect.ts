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
