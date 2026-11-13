"use client";

import { useActionState, useState } from "react";

import { signUp, type SignupState } from "./actions";
import { TurnstileWidget } from "./turnstile-widget";

const INITIAL_STATE: SignupState = { status: "idle" };

export function SignupForm({
  siteKey,
  privacyUrl,
}: {
  readonly siteKey: string;
  readonly privacyUrl: string;
}) {
  const [state, formAction, isPending] = useActionState(signUp, INITIAL_STATE);
  const [hasToken, setHasToken] = useState(false);

  if (state.status === "sent") {
    return (
      <div className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-6">
        <h2 className="text-xl font-bold tracking-tight">
          Confira o seu e-mail.
        </h2>
        <p className="text-muted">
          Mandamos um link para{" "}
          <span className="font-mono text-sm">{state.email}</span>. Se você já
          tem conta, o link é para entrar.
        </p>
        <p className="text-faint text-sm">
          Não chegou? Confira o spam. O link vale por 24 horas.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="font-semibold">
          Seu nome
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          autoFocus
          maxLength={120}
          defaultValue={state.status === "error" ? state.name : undefined}
          className="border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 outline-none"
        />
      </div>

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
          placeholder="voce@exemplo.com"
          defaultValue={state.status === "error" ? state.email : undefined}
          aria-describedby={
            state.status === "error" ? "signup-error" : undefined
          }
          className="border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 outline-none"
        />
      </div>

      <TurnstileWidget
        siteKey={siteKey}
        resetKey={state}
        onToken={setHasToken}
      />

      {state.status === "error" && (
        <p id="signup-error" role="alert" className="text-accent text-sm">
          {state.message}
        </p>
      )}

      <p className="text-faint text-sm">
        Ao se cadastrar, você concorda com os{" "}
        <a
          href={privacyUrl}
          target="_blank"
          rel="noreferrer"
          className="text-muted underline"
        >
          termos de privacidade
        </a>
        .
      </p>

      <button
        type="submit"
        disabled={isPending || !hasToken}
        className="bg-accent text-accent-foreground rounded-sm px-5 py-3 font-semibold disabled:opacity-60"
      >
        {isPending ? "Enviando..." : "Cadastrar"}
      </button>
    </form>
  );
}
