import { env } from "@/lib/env";

import { SignOutButton } from "../auth/sign-out-button";

/**
 * Someone signed in with no membership in any school.
 *
 * Rare since 0031, but still reachable: an account whose invite was cancelled
 * or expired after the account existed. A blank screen here would read as a
 * bug, so it says how one gets in (an invite) and how to get unstuck.
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
        A entrada na Chelsea St é por convite. Se você recebeu um convite por
        e-mail, abra o link dele. Se o link venceu, peça um novo a quem convidou
        você.
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
