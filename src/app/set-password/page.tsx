import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { BrandMark } from "../brand-mark";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = {
  title: "Definir senha",
};

/**
 * Where the invite link and the "forgot my password" link land, already
 * signed in by /auth/callback. The proxy turns away anyone without a session;
 * the check here is for the email shown, not for safety.
 */
export default async function SetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-3">
        <BrandMark />
        <h1 className="text-3xl font-extrabold tracking-tight">
          Definir senha
        </h1>
        <p className="text-muted">
          Para entrar daqui em diante com{" "}
          <span className="font-mono text-sm">{user.email}</span> e esta senha.
        </p>
      </div>

      <NewPasswordForm />
    </main>
  );
}
