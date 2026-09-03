import { env } from "@/lib/env";

/**
 * Someone signed in before being registered as a student.
 *
 * Reachable by design: sign-in creates the auth user, and only the teacher
 * creates the row in `students`. A blank screen here would read as a bug, so it
 * says what happened and how to get unstuck.
 */
export function AccountPending() {
  const contact = env.NEXT_PUBLIC_TEACHER_CONTACT_EMAIL;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        Chelsea St
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight">
        Sua conta ainda não foi liberada.
      </h1>
      <p className="text-muted">
        O acesso funcionou, mas você ainda não está cadastrada como aluna. Isso
        é o professor quem faz.
      </p>
      {contact ? (
        <p className="text-muted">
          Fale com o professor em{" "}
          <a href={`mailto:${contact}`} className="text-accent font-semibold">
            {contact}
          </a>
          .
        </p>
      ) : (
        <p className="text-muted">
          Fale com o professor pelo canal de sempre para liberar o acesso.
        </p>
      )}
    </main>
  );
}
