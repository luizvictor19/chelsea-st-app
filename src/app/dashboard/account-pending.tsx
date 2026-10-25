import { env } from "@/lib/env";

import { SignOutButton } from "../auth/sign-out-button";

/**
 * Someone signed in with no membership in any school.
 *
 * Rare since 0031, but still reachable: an account whose invite was cancelled
 * or expired after the account existed. Anyone here has a confirmed email, so
 * a new invite is accepted the moment it is written (0031) and no email comes:
 * the copy says to reload, not to wait for a link.
 */
export function AccountPending() {
  const contact = env.NEXT_PUBLIC_TEACHER_CONTACT_EMAIL;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Chelsea St
        </p>
        {/* Signed in with the wrong email, perhaps: the way back out. */}
        <SignOutButton />
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight">
        Sua conta ainda não tem acesso.
      </h1>
      <p className="text-muted">
        A entrada na Chelsea St é por convite. Peça um convite a quem cuida da
        sua turma, para este mesmo e-mail. Como você já tem conta, ele vale
        assim que for enviado: depois, é só recarregar esta página.
      </p>
      {contact ? (
        <p className="text-muted">
          Dúvidas:{" "}
          <a
            href={`mailto:${contact}`}
            className="text-accent hover:text-foreground font-semibold transition-colors"
          >
            {contact}
          </a>
          .
        </p>
      ) : null}
    </main>
  );
}
