"use client";

import { useActionState } from "react";

import { saveSeats, type FounderState } from "./actions";

const INITIAL: FounderState = { status: "idle" };

/** The total of founder seats, and how many are left. */
export function SeatsForm({
  total,
  left,
}: {
  readonly total: number | null;
  readonly left: number | null;
}) {
  const [state, formAction, isPending] = useActionState(saveSeats, INITIAL);

  return (
    <form
      action={formAction}
      className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-4 text-sm"
    >
      <p>
        {total === null
          ? "Nenhum total escrito: ninguém ganha o selo até haver vagas."
          : `Vagas restantes: ${left ?? 0} de ${total}.`}
      </p>
      <label className="flex flex-col gap-1">
        Total de vagas de fundador
        <input
          name="seats_total"
          defaultValue={total ?? ""}
          inputMode="numeric"
          required
          className="border-rule bg-surface focus:border-accent rounded-sm border px-3 py-2 outline-none"
        />
      </label>
      <p className="text-muted">
        Uma vaga é um selo vivo. Tirar um selo devolve a vaga; um cancelamento
        de assinatura não devolve. Um total menor que os selos que existem não
        tira o selo de ninguém: as vagas ficam em zero.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="bg-accent text-on-accent self-start rounded-sm px-4 py-2 font-semibold disabled:opacity-60"
        >
          {isPending ? "Salvando…" : "Salvar total"}
        </button>
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
      </div>
    </form>
  );
}
