import type { Metadata } from "next";
import Link from "next/link";

import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: "Esqueci minha senha · Chelsea St",
};

/** Also the way to a first password, for an account that never had one. */
export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-3">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Chelsea St
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Esqueci minha senha
        </h1>
        <p className="text-muted">
          Você recebe um link por e-mail e escolhe uma senha nova. Serve também
          para definir a primeira.
        </p>
      </div>

      <ResetForm />

      <p className="text-muted text-sm">
        <Link href="/login" className="text-foreground underline">
          Voltar para entrar
        </Link>
      </p>
    </main>
  );
}
