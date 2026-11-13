"use client";

import { useState, useTransition } from "react";

import type { OrganizationRole } from "@/lib/access";
import { roleLabel } from "@/lib/invites";

import { CopyButton } from "../copy-button";
import { notices } from "../notices";

import { cancelInvite, resendInvite, type RowResult } from "./actions";
import {
  cancelFounderInvite,
  resendFounderInvite,
} from "./founder-invite-actions";
import { endPersonalPlan, resendPersonalPlan } from "./personal-plan-actions";

export type OpenInvite = {
  readonly id: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly expiresAt: string;
  /** Decided on the server, so the two renders agree. */
  readonly expired: boolean;
  /** Whether the reader may renew and cancel it, which RLS also decides. */
  readonly manageable: boolean;
  readonly organizationName: string;
  /** Whether its organization has a teacher (0042): it names the role. */
  readonly hasTeacher: boolean;
};

/** A Plano Fundador Personalizado still waiting for its account (0058). */
export type WaitingPersonalPlan = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
};

/** A founder invite still open (0059). */
export type OpenFounderInvite = {
  readonly id: string;
  readonly email: string;
  readonly expiresAt: string;
  /** Decided on the server, so the two renders agree. */
  readonly expired: boolean;
  /** The signup link of its e-mail, to send by hand; null with no site. */
  readonly link: string | null;
};

const DAY = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function InviteList({
  invites,
  showOrganization,
  personalPlans = [],
  founderInvites = [],
}: {
  readonly invites: readonly OpenInvite[];
  readonly showOrganization: boolean;
  readonly personalPlans?: readonly WaitingPersonalPlan[];
  readonly founderInvites?: readonly OpenFounderInvite[];
}) {
  return (
    <section aria-labelledby="open-invites" className="flex flex-col gap-3">
      <h2 id="open-invites" className="text-xl font-bold tracking-tight">
        Convites em aberto
      </h2>
      {invites.length === 0 &&
      personalPlans.length === 0 &&
      founderInvites.length === 0 ? (
        <p className="text-muted">Nenhum convite esperando resposta.</p>
      ) : (
        <ul className="border-rule divide-rule divide-y rounded-sm border">
          {invites.map((invite) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              showOrganization={showOrganization}
            />
          ))}
          {founderInvites.map((invite) => (
            <FounderInviteRow key={invite.id} invite={invite} />
          ))}
          {personalPlans.map((plan) => (
            <PersonalPlanRow key={plan.id} plan={plan} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FounderInviteRow({ invite }: { readonly invite: OpenFounderInvite }) {
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
    <li className="flex flex-col gap-3 p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-mono text-sm">{invite.email}</span>
        <span className="text-muted text-sm">
          Fundador ·{" "}
          {invite.expired
            ? "vencido"
            : `vale até ${DAY.format(new Date(invite.expiresAt))}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(resendFounderInvite)}
          className="border-rule hover:border-foreground rounded-sm border px-3 py-1.5 text-sm disabled:opacity-60"
        >
          Reenviar
        </button>
        {invite.link !== null && (
          <CopyButton
            text={invite.link}
            label="Copiar link"
            className="border-rule hover:border-foreground rounded-sm border px-3 py-1.5 text-sm"
          />
        )}
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(cancelFounderInvite)}
          className="text-muted hover:text-foreground rounded-sm px-3 py-1.5 text-sm disabled:opacity-60"
        >
          Cancelar convite
        </button>
      </div>
    </li>
  );
}

function PersonalPlanRow({ plan }: { readonly plan: WaitingPersonalPlan }) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function run(action: (id: string) => Promise<RowResult>) {
    startTransition(async () => {
      const result = await action(plan.id);
      if (result.status === "error") {
        notices.push("error", result.message);
      } else if (result.status === "sent") {
        notices.push("success", `E-mail reenviado para ${plan.email}.`);
      } else {
        notices.push("success", `${plan.name} saiu de venda.`);
      }
    });
  }

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-mono text-sm">{plan.email}</span>
        <span className="text-muted text-sm">
          Plano personalizado · {plan.name} · aguardando cadastro
        </span>
      </div>
      {!confirming ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(resendPersonalPlan)}
            className="border-rule hover:border-foreground rounded-sm border px-3 py-1.5 text-sm disabled:opacity-60"
          >
            Reenviar
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirming(true)}
            className="text-muted hover:text-foreground rounded-sm px-3 py-1.5 text-sm disabled:opacity-60"
          >
            Tirar de venda
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Tirar {plan.name} de venda? O plano some para essa pessoa, e o link
            do e-mail não leva mais a ele.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setConfirming(false);
                run(endPersonalPlan);
              }}
              className="bg-accent text-on-accent rounded-sm px-3 py-1.5 font-semibold disabled:opacity-60"
            >
              Sim, tirar de venda
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="border-rule rounded-sm border px-3 py-1.5"
            >
              Não, manter
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function InviteRow({
  invite,
  showOrganization,
}: {
  readonly invite: OpenInvite;
  readonly showOrganization: boolean;
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
          {roleLabel(invite.role, invite.hasTeacher)}
          {showOrganization ? ` · ${invite.organizationName}` : ""}
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
          Só o admin da organização reenvia ou cancela
        </span>
      )}
    </li>
  );
}
