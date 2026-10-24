"use server";

import { redirect } from "next/navigation";

import { looksLikeEmail, normalizeEmail } from "@/lib/credentials";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

// The email goes back to the form: React resets it when the action ends.
export type PasswordLoginState =
  { status: "idle" } | { status: "error"; message: string; email: string };

/**
 * Signs in with email and password, then hands over to the front door, which
 * decides between /teacher and /dashboard.
 *
 * A wrong password and an unknown address get the same sentence: telling them
 * apart would answer "does this person study here?", which is nobody's
 * business. The sentence also names the way out for someone who never had a
 * password, which is everyone who joined before #96.
 */
export async function signInWithPassword(
  _previous: PasswordLoginState,
  formData: FormData,
): Promise<PasswordLoginState> {
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");

  if (!looksLikeEmail(email)) {
    return { status: "error", message: "Digite um e-mail válido.", email };
  }
  if (password === "") {
    return { status: "error", message: "Digite a sua senha.", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "invalid_credentials") {
      return {
        status: "error",
        email,
        message:
          "E-mail ou senha não conferem. Nunca definiu uma senha? Use “Esqueci minha senha”.",
      };
    }
    if (error.code === "email_not_confirmed") {
      return {
        status: "error",
        email,
        message:
          "Esse e-mail ainda não foi confirmado. Abra o link que chegou por e-mail.",
      };
    }
    return {
      status: "error",
      email,
      message:
        "Não foi possível entrar agora. Tente de novo em alguns instantes.",
    };
  }

  redirect("/");
}

/**
 * Sends the magic link.
 *
 * The reply is the same whether or not the address already has an account.
 * Answering differently would turn this form into a way of asking "does this
 * person study here?", and the answer is nobody's business.
 *
 * That falls out of the flow rather than being faked: sign-ups are allowed, so
 * an unknown address is a real success too. It creates an auth user with a
 * profile and no membership, which is exactly the "account not released" state
 * the dashboard already handles. So the error below can be shown honestly
 * without leaking anything, because it never depends on the address existing.
 */
export async function sendMagicLink(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = normalizeEmail(formData.get("email"));

  if (!looksLikeEmail(email)) {
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
