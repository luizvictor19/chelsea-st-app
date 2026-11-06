"use server";

import { recoveryOptions } from "@/lib/auth-links";
import { looksLikeEmail, normalizeEmail } from "@/lib/credentials";
import { currentSite } from "@/lib/current-site";
import { createClient } from "@/lib/supabase/server";

export type ResetState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

/**
 * Sends the link that leads to /set-password.
 *
 * Same answer for an address with an account and one without, for the reason
 * the login gives. The redirect is only the origin of this request's site
 * (src/lib/auth-links.ts): the reset template adds the path, /set-password
 * included (docs/commands.md).
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
  const { error } = await supabase.auth.resetPasswordForEmail(
    email,
    recoveryOptions(await currentSite()),
  );

  if (error) {
    return {
      status: "error",
      message:
        "Não foi possível enviar o link agora. Tente de novo em alguns instantes.",
    };
  }

  return { status: "sent", email };
}
