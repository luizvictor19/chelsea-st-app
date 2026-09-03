"use server";

import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

// Deliberately permissive. The address is proved by the fact that a link sent
// to it gets clicked; a stricter pattern here only rejects valid addresses.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sends the magic link.
 *
 * The reply is the same whether or not the address already has an account.
 * Answering differently would turn this form into a way of asking "does this
 * person study here?", and the answer is nobody's business.
 *
 * That falls out of the flow rather than being faked: sign-ups are allowed, so
 * an unknown address is a real success too. It creates an auth user with a
 * profile and no row in `students`, which is exactly the "account not released"
 * state the dashboard already handles. So the error below can be shown honestly
 * without leaking anything, because it never depends on the address existing.
 */
export async function sendMagicLink(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!LOOKS_LIKE_EMAIL.test(email)) {
    return { status: "error", message: "Digite um e-mail válido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback` },
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
