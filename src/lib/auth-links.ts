import type { Site } from "./brand.ts";

/*
 * Where the link of an auth email leads (#196): the origin of the site the
 * request came from, so an invite or a new password asked for on the GrifoAI
 * domain stays there.
 *
 * Only the origin, no path. The email templates add
 * /auth/callback?token_hash=… after {{ .RedirectTo }} (docs/commands.md).
 * Supabase checks the value again against its Redirect URLs, and when it
 * refuses one it puts its Site URL in that place: with an origin, the link is
 * still whole, only on the Chelsea domain.
 *
 * The origin comes from the allowlist of src/lib/brand.ts, never from the
 * text of the Host header. A host outside the list sends no redirect at all,
 * and Supabase uses its Site URL, as a preview does today: a forged Host never
 * becomes the start of a link that carries a token_hash.
 *
 * Pure on purpose: node:test runs this file as plain TypeScript, and the
 * actions that call it import next/headers and Supabase.
 */

/** Options of signInWithOtp. Nobody gets an account without an invite (0031). */
export function magicLinkOptions(site: Site | null): {
  shouldCreateUser: false;
  emailRedirectTo?: string;
} {
  return site
    ? { shouldCreateUser: false, emailRedirectTo: site.origin }
    : { shouldCreateUser: false };
}

/** Options of resetPasswordForEmail. */
export function recoveryOptions(site: Site | null): { redirectTo?: string } {
  return site ? { redirectTo: site.origin } : {};
}

/**
 * Options of inviteUserByEmail. The inviter's site until #195, which reads the
 * domain of the organization invited and changes only this call's argument.
 */
export function inviteOptions(site: Site | null): { redirectTo?: string } {
  return site ? { redirectTo: site.origin } : {};
}
