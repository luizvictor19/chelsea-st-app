import type { Site } from "./brand.ts";

/*
 * Where the link of an auth email leads (#196): the origin of the site the
 * request came from, so an invite or a new password asked for on the GrifoAI
 * domain stays there.
 *
 * Only the origin, no path: the email templates add
 * /auth/callback?token_hash=… after it (docs/commands.md). When Supabase
 * refuses the value it puts its Site URL in {{ .RedirectTo }}, and the link
 * is still whole, only on the Chelsea domain.
 *
 * The origin comes from the allowlist of src/lib/brand.ts, never from the
 * text of the Host header, and a host outside the list sends no redirect at
 * all. That covers what this app asks for, not what reaches the email:
 * anyone with the public key can call Supabase directly, with any redirect
 * on the Site URL's hostname, path and query included. What fixes the start
 * of the link is the templates, which use {{ .RedirectTo }} only when it is
 * one of the listed origins whole, and the Site URL otherwise.
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
 *
 * Only an https origin. The invitee is not the person who asked: she opens
 * the email on her own machine, where the http origin of a dev server (which
 * talks to the production project) leads nowhere. Such an invite gets the
 * Site URL, as every invite did before #196.
 */
export function inviteOptions(site: Site | null): { redirectTo?: string } {
  return site?.origin.startsWith("https://") ? { redirectTo: site.origin } : {};
}
