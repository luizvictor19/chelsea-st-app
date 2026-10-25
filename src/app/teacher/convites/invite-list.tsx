"use client";

import { useTransition } from "react";

import type { SchoolRole } from "@/lib/access";
import { ROLE_LABEL } from "@/lib/invites";

import { notices } from "../notices";

import { cancelInvite, resendInvite, type RowResult } from "./actions";

export type OpenInvite = {
  readonly id: string;
  readonly email: string;
  readonly role: SchoolRole;
  readonly expiresAt: string;
  /** Decided on the server, so the two renders agree. */
  readonly expired: boolean;
  /** Whether the reader may renew and cancel it, which RLS also decides. */
  readonly manageable: boolean;
  /** Null when the school is not one the reader invites to. */
  readonly schoolName: string | null;
};

const DAY = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function InviteList({
  invites,
  showSchool,
}: {
  readonly invites: readonly OpenInvite[];
  readonly showSchool: boolean;
}) {
  return (
    <section aria-labelledby="open-invites" className="flex flex-col gap-3">
      <h2 id="open-invites" className="text-xl font-bold tracking-tight">
        Convites em aberto
      </h2>
      {invites.length === 0 ? (
        <p className="text-muted">Nenhum convite esperando resposta.</p>
      ) : (
        <ul className="border-rule divide-rule divide-y rounded-sm border">
          {invites.map((invite) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              showSchool={showSchool}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteRow({
  invite,
  showSchool,
}: {
  readonly invite: OpenInvite;
  readonly showSchool: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function run(action: (id: string) => Promise<RowResult>) {
    startTransition(async () => {
      const result = await action(invite.id);
      if (result.status === "error") {
        notices.push("error", result.message);
      } else if (result.status === "sent") {
        notices.push("success", `Convite reenviado para ${invite.email}.`);
      } else {
        notices.push("success", `Convite para ${invite.email} cancelado.`);
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-mono text-sm">{invite.email}</span>
        <span className="text-muted text-sm">
          {ROLE_LABEL[invite.role]}
          {showSchool && invite.schoolName ? ` · ${invite.schoolName}` : ""}
          {" · "}
          {invite.expired
            ? "vencido"
            : `vale até ${DAY.format(new Date(invite.expiresAt))}`}
        </span>
      </div>
      {invite.manageable ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(resendInvite)}
            className="border-rule hover:border-foreground rounded-sm border px-3 py-1.5 text-sm disabled:opacity-60"
          >
            Reenviar
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(cancelInvite)}
            className="text-muted hover:text-foreground rounded-sm px-3 py-1.5 text-sm disabled:opacity-60"
          >
            Cancelar convite
          </button>
        </div>
      ) : (
        <span className="text-faint text-sm">
          Só o admin da escola reenvia ou cancela
        </span>
      )}
    </li>
  );
}
