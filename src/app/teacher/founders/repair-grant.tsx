"use client";

import { useActionState } from "react";

import { grantSeal, type FounderState } from "./actions";

const INITIAL: FounderState = { status: "idle" };

/** Giving the seal by hand: a repair, and it takes a seat like any seal. */
export function RepairGrant({
  students,
}: {
  readonly students: readonly { readonly id: string; readonly name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(grantSeal, INITIAL);

  return (
    <form
      action={formAction}
      className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-4 text-sm"
    >
      <p className="text-muted">
        Use só para corrigir: quem esqueceu o cupom, quem se cadastrou antes dos
        cupons, ou quem você decidiu fazer fundadora. Gasta uma vaga.
      </p>
      {students.length === 0 ? (
        <p className="text-muted">Nenhuma aluna sem selo.</p>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            Aluna
            <select
              name="person_id"
              required
              className="border-rule bg-surface focus:border-accent rounded-sm border px-3 py-2 outline-none"
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="bg-accent text-accent-foreground self-start rounded-sm px-4 py-2 font-semibold disabled:opacity-60"
          >
            {isPending ? "Dando…" : "Dar o selo à mão"}
          </button>
        </>
      )}
      {state.status === "saved" && (
        <p role="status" className="text-muted">
          {state.message}
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
