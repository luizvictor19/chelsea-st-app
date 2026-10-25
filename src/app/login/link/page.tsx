import type { Metadata } from "next";
import Link from "next/link";

import { MagicLinkForm } from "../magic-link-form";

export const metadata: Metadata = {
  title: "Entrar sem senha · Chelsea St",
};

/** The way in from before #96, kept for whoever prefers no password. */
export default function MagicLinkPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-3">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Chelsea St
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Entrar sem senha
        </h1>
        <p className="text-muted">
          Você recebe um link por e-mail e entra com um clique.
        </p>
      </div>

      <MagicLinkForm />

      <p className="text-muted text-sm">
        <Link href="/login" className="text-foreground underline">
          Entrar com senha
        </Link>
      </p>
    </main>
  );
}
