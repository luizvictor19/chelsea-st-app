/** What the magic-link form says after asking Supabase for a link. */
export type MagicLinkOutcome = "sent" | "error";

/**
 * The refusals Supabase gives for an address with no account: `otp_disabled`
 * when the call says shouldCreateUser: false, `signup_disabled` once sign-ups
 * are off in the Auth dashboard. Nobody joins without an invite (0031), so no
 * link goes out and no account is made.
 */
const NO_ACCOUNT_CODES: ReadonlySet<string> = new Set([
  "otp_disabled",
  "signup_disabled",
]);

/**
 * An address without an account reads as sent, exactly like one with an
 * account: telling them apart would answer "does this person study here?",
 * which is nobody's business. Every other failure is said as one.
 */
export function magicLinkOutcome(
  errorCode: string | null | undefined,
  failed: boolean,
): MagicLinkOutcome {
  if (!failed) {
    return "sent";
  }
  return errorCode && NO_ACCOUNT_CODES.has(errorCode) ? "sent" : "error";
}
