"use client";

import { useActionState } from "react";

import { sendMagicLink, type LoginState } from "./actions";

const INITIAL_STATE: LoginState = { status: "idle" };

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    sendMagicLink,
    INITIAL_STATE,
  );

  if (state.status === "sent") {
    return (
      <div className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-6">
        <h2 className="text-xl font-bold tracking-tight">Link enviado.</h2>
        <p className="text-muted">
          Se houver uma conta para{" "}
          <span className="font-mono text-sm">{state.email}</span>, o link de
          acesso chegou na caixa de entrada. Ele vale por pouco tempo, então
          abra logo.
        </p>
        <p className="text-faint text-sm">
          Não chegou? Confira o spam antes de pedir outro.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="font-semibold">
          Seu e-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="voce@exemplo.com"
          aria-describedby={
            state.status === "error" ? "email-error" : undefined
          }
          className="border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 outline-none"
        />
      </div>

      {state.status === "error" && (
        <p id="email-error" role="alert" className="text-accent text-sm">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="bg-accent text-accent-foreground rounded-sm px-5 py-3 font-semibold disabled:opacity-60"
      >
        {isPending ? "Enviando..." : "Receber link de acesso"}
      </button>
    </form>
  );
}
