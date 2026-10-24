"use client";

import { useActionState } from "react";

import { MIN_PASSWORD_LENGTH } from "@/lib/credentials";

import { setPassword, type NewPasswordState } from "./actions";

const INITIAL_STATE: NewPasswordState = { status: "idle" };

const inputClass =
  "border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 outline-none";

export function NewPasswordForm() {
  const [state, formAction, isPending] = useActionState(
    setPassword,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="font-semibold">
          Senha nova
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          minLength={MIN_PASSWORD_LENGTH}
          aria-describedby="password-rule"
          className={inputClass}
        />
        <p id="password-rule" className="text-faint text-sm">
          Pelo menos {MIN_PASSWORD_LENGTH} caracteres.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="confirmation" className="font-semibold">
          A mesma senha de novo
        </label>
        <input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
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
        {isPending ? "Salvando..." : "Salvar senha e entrar"}
      </button>
    </form>
  );
}
