/**
 * The checks every sign-in form shares. Kept apart from the forms so the
 * rules are tested once and read the same everywhere.
 */

/**
 * Supabase Auth keeps the password minimum in the dashboard, and the plan of
 * #96 sets it to 8 there too. Checked here first so the person reads the rule
 * in Portuguese, before the request goes out.
 */
export const MIN_PASSWORD_LENGTH = 8;

// Deliberately permissive. The address is proved by the fact that a link sent
// to it gets clicked; a stricter pattern here only rejects valid addresses.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed and lower case, the way auth.users and school_invites store it. */
export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

export function looksLikeEmail(email: string): boolean {
  return LOOKS_LIKE_EMAIL.test(email);
}

/** What is wrong with a new password, in the words the screen shows, or null. */
export function passwordProblem(
  password: string,
  confirmation: string,
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password !== confirmation) {
    return "As duas senhas não são iguais.";
  }
  return null;
}
