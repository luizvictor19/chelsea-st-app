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
   * Shown to someone who signed in before being registered as a student, so
   * they have a way to reach a human. Optional: when it is unset the screen
   * simply omits the address rather than inventing one.
   */
  NEXT_PUBLIC_TEACHER_CONTACT_EMAIL:
    process.env.NEXT_PUBLIC_TEACHER_CONTACT_EMAIL ?? "",
} as const;
