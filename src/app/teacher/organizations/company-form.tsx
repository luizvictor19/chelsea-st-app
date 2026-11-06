"use client";

import { useActionState, useState } from "react";

import { slugFromName } from "@/lib/organizations";

import { createCompanyOrganization, type CompanyState } from "./actions";

const INITIAL_STATE: CompanyState = { status: "idle" };

const fieldClass =
  "border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 outline-none";

/**
 * A new company and its first admin. The address follows the name until it is
 * typed by hand; a refusal keeps everything typed (the action sends it back).
 */
export function CompanyForm({ brandName }: { readonly brandName: string }) {
  const [state, formAction, isPending] = useActionState(
    createCompanyOrganization,
    INITIAL_STATE,
  );
  // Every answer of the action is a new object, also one equal to the last:
  // counted here, the fields remount on each (React's pattern for state that
  // follows a prop or another state).
  const [answered, setAnswered] = useState(state);
  const [round, setRound] = useState(0);
  if (state !== answered) {
    setAnswered(state);
    setRound(round + 1);
  }

  return (
    <form
      action={formAction}
      className="border-rule bg-surface flex flex-col gap-4 rounded-sm border p-6"
    >
      {/* Remounted on every answer, so the fields start from what it sent
          back: what was typed after a refusal, empty after a creation. */}
      <CompanyFields
        key={round}
        kept={state.status === "error" ? state : null}
      />

      <p className="text-muted text-sm">Marca {brandName}, sem professor.</p>

      {state.status === "error" && (
        <p role="alert" className="text-accent text-sm">
          {state.message}
        </p>
      )}
      {state.status === "created-with-problem" && (
        <p role="alert" className="text-accent text-sm">
          {state.message} O e-mail do admin era{" "}
          <span className="font-mono">{state.email}</span>.
        </p>
      )}
      {state.status === "created" && (
        <p role="status" className="text-muted text-sm">
          Empresa criada. Convite enviado para{" "}
          <span className="font-mono">{state.email}</span>.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="bg-accent text-accent-foreground self-start rounded-sm px-5 py-3 font-semibold disabled:opacity-60"
      >
        {isPending ? "Criando..." : "Criar e convidar"}
      </button>
    </form>
  );
}

function CompanyFields({
  kept,
}: {
  readonly kept: { name: string; slug: string; email: string } | null;
}) {
  const [name, setName] = useState(kept?.name ?? "");
  const [slug, setSlug] = useState(kept?.slug ?? "");
  // A slug sent back that is not the name's own was typed by hand: it stays.
  const [slugTyped, setSlugTyped] = useState(
    kept !== null && kept.slug !== slugFromName(kept.name),
  );

  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor="company-name" className="font-semibold">
          Nome da empresa
        </label>
        <input
          id="company-name"
          name="name"
          type="text"
          autoComplete="off"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugTyped) setSlug(slugFromName(event.target.value));
          }}
          className={fieldClass}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="company-slug" className="font-semibold">
          Endereço
        </label>
        <input
          id="company-slug"
          name="slug"
          type="text"
          autoComplete="off"
          required
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value);
            setSlugTyped(true);
          }}
          aria-describedby="company-slug-hint"
          className={`${fieldClass} font-mono`}
        />
        <p id="company-slug-hint" className="text-faint text-xs">
          Letras minúsculas sem acento, números e hífens. Não muda depois.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="company-email" className="font-semibold">
          E-mail do primeiro admin
        </label>
        <input
          id="company-email"
          name="email"
          type="email"
          autoComplete="off"
          required
          placeholder="pessoa@empresa.com"
          defaultValue={kept?.email}
          className={fieldClass}
        />
      </div>
    </>
  );
}
