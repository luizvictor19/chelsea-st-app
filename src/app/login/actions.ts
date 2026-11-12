"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";

import { magicLinkOptions, recoveryOptions } from "@/lib/auth-links";
import { looksLikeEmail, normalizeEmail } from "@/lib/credentials";
import { currentSite } from "@/lib/current-site";
import { requestLink } from "@/lib/link-request";
import { magicLinkStep } from "@/lib/magic-link";
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
 * The screen says "sent" for every valid address, at once, and the email goes
 * out after the response (src/lib/link-request.ts, #110): the time of the
 * answer and every error GoTrue gives once it finds the account would say
 * whether the address has one, and that is nobody's business. A failure goes
 * to the server log only, without the address.
 *
 * Nobody gets an account without an invite (0031), so an unknown address gets
 * no link and no account: shouldCreateUser is off, and Supabase refuses. An
 * invite not yet accepted gets the recovery link instead (magicLinkStep).
 *
 * The site and the client are read before the answer: inside `after` the
 * request is over, and the token_hash link the templates send needs no
 * cookie set there.
 */
export async function sendMagicLink(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = normalizeEmail(formData.get("email"));
  const site = await currentSite();
  const supabase = await createClient();

  return requestLink({
    email,
    flow: "magic_link",
    send: async () => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: magicLinkOptions(site),
      });
      const step = magicLinkStep(error);
      if (step === "sent") {
        return null;
      }
      if (step === "error") {
        return error;
      }
      const { error: recoveryError } =
        await supabase.auth.resetPasswordForEmail(email, recoveryOptions(site));
      return recoveryError;
    },
    schedule: after,
    log: console,
  });
}
