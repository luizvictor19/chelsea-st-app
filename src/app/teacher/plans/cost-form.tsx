"use client";

import { useActionState } from "react";

import { saveCost, type CostState } from "./actions";

const INITIAL: CostState = { status: "idle" };

const fieldClass =
  "border-rule bg-surface focus:border-accent w-24 rounded-sm border px-3 py-2 outline-none";

/** One action in one brand: what a unit of it costs, in credits. */
export function CostForm({
  brand,
  action,
  label,
  credits,
}: {
  readonly brand: string;
  readonly action: string;
  readonly label: string;
  readonly credits: number | null;
}) {
  const [state, formAction, isPending] = useActionState(saveCost, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="brand" value={brand} />
      <input type="hidden" name="action" value={action} />
      <label className="flex flex-col gap-1">
        {label}
        <input
          name="credits"
          defaultValue={credits ?? ""}
          placeholder="não vende"
          inputMode="numeric"
          required
          className={fieldClass}
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="bg-accent text-accent-foreground rounded-sm px-4 py-2 font-semibold disabled:opacity-60"
      >
        {isPending ? "Salvando…" : "Salvar custo"}
      </button>
      {state.status === "saved" && (
        <p role="status" className="text-muted">
          {state.label} salvo.
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-accent">
          {state.message}
        </p>
      )}
    </form>
  );
}
