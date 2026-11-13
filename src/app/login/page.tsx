import type { Metadata } from "next";
import Link from "next/link";

import { pageMetadata } from "@/lib/brand";
import { currentSite } from "@/lib/current-site";

import { BrandMark } from "../brand-mark";
import { signupDoorHere } from "../cadastro/door";
import { PasswordForm } from "./password-form";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(await currentSite(), "Entrar", "/login");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // The way to /cadastro, only where it takes people (#275).
  const signup = signupDoorHere(await currentSite()) === "open";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-3">
        <BrandMark />
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

      {signup && (
        <p className="text-muted text-sm">
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="text-foreground underline">
            Cadastre-se
          </Link>
          .
        </p>
      )}
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
      Entre com a sua senha ou peça outro link. Primeiro acesso, por convite?
      Use “Esqueci minha senha” com o e-mail do convite.
    </p>
  );
}
