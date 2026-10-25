/**
 * What to do after asking Supabase for a magic link: tell the form it went
 * out, send the recovery link instead, or say it failed.
 */
export type MagicLinkStep = "sent" | "recover" | "error";

/**
 * Read from GoTrue's source (supabase/auth, internal/api/otp.go,
 * magic_link.go, recover.go and verify.go, 2026-10-25):
 *
 * - `otp_disabled`: shouldCreateUser is false and no account has the address.
 *   Nobody joins without an invite (0031), so no link and no account, and the
 *   form says sent, exactly as for an address with an account: telling them
 *   apart would answer "does this person study here?".
 * - `signup_disabled`: the account exists but is not confirmed, which is an
 *   invite not yet accepted. GoTrue sends it through Signup, refused once
 *   sign-ups are off. The recovery link has no such check, and verifying it
 *   confirms the email, which accepts the invite: so that one goes out.
 */
export function magicLinkStep(
  error: { readonly code?: string } | null,
): MagicLinkStep {
  if (error === null || error.code === "otp_disabled") {
    return "sent";
  }
  if (error.code === "signup_disabled") {
    return "recover";
  }
  return "error";
}
