"use client";

import { useActionState, useState } from "react";

import { INVITE_DAYS, type FounderInviteState } from "@/lib/founder-invite";

import { inviteFounder } from "./founder-invite-actions";

const INITIAL: FounderInviteState = { status: "idle" };

const fieldClass =
  "border-rule bg-surface focus:border-accent rounded-sm border px-3 py-2 outline-none";

/**
 * A founder invite for one e-mail (#296): the seal comes when she confirms
 * that e-mail, or at once when an account is already confirmed with it. The
 * invite reserves no seat: the seats left are shown beside it.
 */
export function FounderInviteForm({
  seatsLeft,
}: {
  readonly seatsLeft: number | null;
}) {
  const [state, formAction, isPending] = useActionState(inviteFounder, INITIAL);

  return (
    <form
      action={formAction}
      className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-6 text-sm"
    >
      <p>
        {seatsLeft === null
          ? "Nenhum total de vagas escrito em Fundadores: o convite não dá selo até haver vagas."
          : `Vagas restantes: ${seatsLeft}.`}
      </p>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">E-mail da pessoa</span>
        <input
          name="email"
          type="email"
          autoComplete="off"
          required
          placeholder="pessoa@exemplo.com"
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Validade em dias
        <input
          name="days"
          inputMode="numeric"
          required
          defaultValue={INVITE_DAYS}
          className={fieldClass}
        />
      </label>
      <p className="text-muted">
        O selo entra quando ela confirmar este e-mail, ou agora, se ela já tem
        conta com ele. O convite não guarda vaga: se as vagas acabarem antes de
        ela confirmar, ela fica sem selo e o convite continua aberto. Aumente o
        total em Fundadores e use Reenviar.
      </p>

      {state.status === "error" && (
        <p role="alert" className="text-accent">
          {state.message}
        </p>
      )}
      {(state.status === "sent" || state.status === "unsent") && (
        <InviteResult state={state} />
      )}

      <button
        type="submit"
        disabled={isPending}
        className="bg-accent text-accent-foreground self-start rounded-sm px-5 py-3 font-semibold disabled:opacity-60"
      >
        {isPending ? "Convidando..." : "Convidar fundadora"}
      </button>
    </form>
  );
}

function InviteResult({
  state,
}: {
  readonly state: Extract<FounderInviteState, { status: "sent" | "unsent" }>;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="flex flex-col gap-2">
      <p className={state.status === "unsent" ? "text-accent" : "text-muted"}>
        {state.granted
          ? "Ela já tinha conta confirmada: o selo foi dado agora."
          : "Convite gravado: o selo entra quando ela confirmar o e-mail."}{" "}
        {state.status === "sent"
          ? `E-mail enviado para ${state.email}.`
          : "O e-mail não saiu: mande o link abaixo, ou use Reenviar."}
      </p>
      {state.link !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-background min-w-0 rounded-sm px-2 py-1 font-mono break-all">
            {state.link}
          </span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(state.link ?? "")
                .then(() => setCopied(true));
            }}
            className="border-rule hover:border-foreground rounded-sm border px-3 py-1"
          >
            {copied ? "Copiado" : "Copiar link"}
          </button>
        </div>
      )}
    </div>
  );
}
