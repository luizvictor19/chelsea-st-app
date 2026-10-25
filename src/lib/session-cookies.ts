/**
 * The cookies that hold a Supabase session in this browser: the auth token
 * (`sb-<project>-auth-token`, split into `.0`, `.1` when it grows) and the PKCE
 * code verifier. @supabase/ssr names every one of them with the `sb-` prefix.
 *
 * Signing out clears them through the auth client. When that call fails, these
 * are the names deleted by hand, so leaving a shared computer never depends on
 * the network.
 */
export function sessionCookieNames(names: readonly string[]): string[] {
  return names.filter((name) => name.startsWith("sb-"));
}
