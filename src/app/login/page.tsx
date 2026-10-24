import type { Metadata } from "next";
import Link from "next/link";

import { PasswordForm } from "./password-form";

export const metadata: Metadata = {
  title: "Entrar · Chelsea St",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-3">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Chelsea St
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">Entrar</h1>
        <p className="text-muted">Com o seu e-mail e a sua senha.</p>
      </div>

      <ExpiredLinkNotice searchParams={searchParams} />
      <PasswordForm />

      <p className="text-muted text-sm">
        Prefere não usar senha?{" "}
        <Link href="/login/link" className="text-foreground underline">
          Entrar com um link por e-mail
        </Link>
        .
      </p>
    </main>
  );
}

/** Shown when /auth/callback could not turn the link into a session. */
async function ExpiredLinkNotice({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (error !== "link") {
    return null;
  }

  return (
    <p role="alert" className="border-accent text-muted rounded-sm border p-4">
      Esse link não funciona mais. Links de acesso expiram e só valem uma vez.
      Entre com a sua senha ou peça outro link.
    </p>
  );
}
