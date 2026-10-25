"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signInWithPassword, type PasswordLoginState } from "./actions";

const INITIAL_STATE: PasswordLoginState = { status: "idle" };

const inputClass =
  "border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 outline-none";

export function PasswordForm() {
  const [state, formAction, isPending] = useActionState(
    signInWithPassword,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="font-semibold">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="voce@exemplo.com"
          defaultValue={state.status === "error" ? state.email : undefined}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor="password" className="font-semibold">
            Senha
          </label>
          <Link
            href="/forgot-password"
            className="text-muted hover:text-foreground text-sm"
          >
            Esqueci minha senha
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby={
            state.status === "error" ? "password-error" : undefined
          }
          className={inputClass}
        />
      </div>

      {state.status === "error" && (
        <p id="password-error" role="alert" className="text-accent text-sm">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="bg-accent text-accent-foreground rounded-sm px-5 py-3 font-semibold disabled:opacity-60"
      >
        {isPending ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
