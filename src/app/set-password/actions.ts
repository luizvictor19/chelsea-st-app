"use server";

import { redirect } from "next/navigation";

import { passwordProblem } from "@/lib/credentials";
import { createClient } from "@/lib/supabase/server";

export type NewPasswordState =
  { status: "idle" } | { status: "error"; message: string };

/**
 * Sets the password of whoever holds the session: the person who just opened
 * an invite or a "forgot my password" link. Then the front door decides where
 * she goes.
 */
export async function setPassword(
  _previous: NewPasswordState,
  formData: FormData,
): Promise<NewPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  const problem = passwordProblem(password, confirmation);
  if (problem !== null) {
    return { status: "error", message: problem };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    if (error.code === "same_password") {
      return {
        status: "error",
        message: "Essa já é a sua senha. Escolha outra ou só entre com ela.",
      };
    }
    if (error.code === "weak_password") {
      return {
        status: "error",
        message: "Essa senha é fácil de adivinhar. Escolha outra, mais longa.",
      };
    }
    if (error.code === "session_not_found" || error.status === 401) {
      return {
        status: "error",
        message: "O link expirou. Peça outro em “Esqueci minha senha”.",
      };
    }
    return {
      status: "error",
      message:
        "Não foi possível salvar a senha agora. Tente de novo em alguns instantes.",
    };
  }

  redirect("/");
}
