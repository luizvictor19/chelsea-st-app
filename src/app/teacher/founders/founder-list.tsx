"use client";

import { useActionState, useState } from "react";

import { revokeSeal, type FounderState } from "./actions";

export type Founder = {
  readonly personId: string;
  readonly name: string;
  /** "Selo de fundador · desde dd/mm/aaaa", decided on the server. */
  readonly since: string;
  readonly source: string;
  /** The day her founder's terms were fixed, or null when not yet. */
  readonly termsSince: string | null;
};

const INITIAL: FounderState = { status: "idle" };

/** Who holds a live Founder seal, each with "Tirar o selo" behind a second yes. */
export function FounderList({
  founders,
}: {
  readonly founders: readonly Founder[];
}) {
  return founders.length === 0 ? (
    <p className="text-muted text-sm">Ninguém tem o selo ainda.</p>
  ) : (
    <ul className="border-rule divide-rule divide-y rounded-sm border">
      {founders.map((founder) => (
        <FounderRow key={founder.personId} founder={founder} />
      ))}
    </ul>
  );
}

function FounderRow({ founder }: { readonly founder: Founder }) {
  const [state, formAction, isPending] = useActionState(revokeSeal, INITIAL);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="flex flex-col gap-2 p-4 text-sm">
      <span className="font-semibold">{founder.name}</span>
      <span className="text-muted">
        {founder.since} · {founder.source} ·{" "}
        {founder.termsSince === null
          ? "preço de fundador ainda não guardado (falta o primeiro pagamento)"
          : `preço de fundador guardado desde ${founder.termsSince}`}
      </span>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-muted self-start underline"
        >
          Tirar o selo
        </button>
      ) : (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="person_id" value={founder.personId} />
          <input type="hidden" name="confirm" value="sim" />
          <p>
            Tirar o selo de {founder.name}? Ela deixa de ver o Plano Fundador e
            não pode mais assinar nem voltar a ele, sem aviso. A assinatura que
            existe continua, e a vaga volta.
          </p>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="bg-accent text-accent-foreground rounded-sm px-4 py-2 font-semibold disabled:opacity-60"
            >
              {isPending ? "Tirando…" : "Sim, tirar o selo"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="border-rule rounded-sm border px-4 py-2"
            >
              Não, manter
            </button>
          </div>
        </form>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-accent">
          {state.message}
        </p>
      )}
    </li>
  );
}
