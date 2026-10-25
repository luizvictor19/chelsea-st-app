/**
 * Reads the environment once and fails loudly at startup when a value is
 * missing, instead of surfacing as an obscure runtime error later.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export const env = {
  NEXT_PUBLIC_SUPABASE_URL: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
  NEXT_PUBLIC_SITE_URL:
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",

  /**
   * One contact for the whole platform (a contact per school is not built:
   * only Chelsea St exists), shown to someone signed in with no access, so they
   * have a way to reach a human. Optional: when it is unset the screen simply
   * omits the address rather than inventing one.
   */
  NEXT_PUBLIC_TEACHER_CONTACT_EMAIL:
    process.env.NEXT_PUBLIC_TEACHER_CONTACT_EMAIL ?? "",
} as const;

/**
 * The service role key, read only when an invite email is sent. A function
 * and not a field of env: env is imported by the browser bundle too, where
 * the key never exists, and the build in CI runs without it. Required at
 * startup, it would fail both, for a page that never sends an invite.
 */
export function serviceRoleKey(): string {
  return required(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
