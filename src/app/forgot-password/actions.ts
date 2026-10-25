"use server";

import { looksLikeEmail, normalizeEmail } from "@/lib/credentials";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type ResetState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

/**
 * Sends the link that leads to /set-password.
 *
 * Same answer for an address with an account and one without, for the reason
 * the login gives. The redirect matters only while the email templates still
 * use Supabase's default link; the templates of #96 name /set-password
 * themselves (docs/commands.md).
 */
export async function sendPasswordReset(
  _previous: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const email = normalizeEmail(formData.get("email"));

  if (!looksLikeEmail(email)) {
    return { status: "error", message: "Digite um e-mail válido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/set-password`,
  });

  if (error) {
    return {
      status: "error",
      message:
        "Não foi possível enviar o link agora. Tente de novo em alguns instantes.",
    };
  }

  return { status: "sent", email };
}
