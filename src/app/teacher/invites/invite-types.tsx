"use client";

import { useState } from "react";

import { FounderInviteForm } from "./founder-invite-form";
import { InviteForm, type InvitableOrganization } from "./invite-form";
import { INVITE_KINDS, type InviteKind } from "./invite-kinds";
import { PersonalPlanForm } from "./personal-plan-form";

/**
 * The one invite screen (#292, 13/11): the kind first, then its form. An
 * invite to an organization, as before; for the platform admin alone, a
 * Plano Fundador Personalizado and a founder invite (#296).
 */
export function InviteTypes({
  organizations,
  platformAdmin,
  seatsLeft = null,
}: {
  readonly organizations: readonly InvitableOrganization[];
  readonly platformAdmin: boolean;
  /** The founder seats left (founder_seats_left), for the founder invite. */
  readonly seatsLeft?: number | null;
}) {
  // Where the signup is the door, a teacher who is not the admin offers no
  // role, and the organization has no form (its open invites still list).
  const offerable = organizations.filter((each) => each.roles.length > 0);
  const kinds: InviteKind[] = [
    ...(offerable.length > 0 ? (["organization"] as const) : []),
    ...(platformAdmin ? (["founder", "personal"] as const) : []),
  ];
  const [kind, setKind] = useState<InviteKind | undefined>(kinds[0]);
  const chosen = kind === undefined ? null : INVITE_KINDS[kind];

  if (kinds.length === 0) {
    return <p className="text-muted">Você não pode convidar ninguém.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {kinds.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">Tipo de convite</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {kinds.map((each) => (
              <label
                key={each}
                className={
                  kind === each
                    ? "border-accent bg-surface flex cursor-pointer gap-3 rounded-sm border p-3"
                    : "border-rule hover:bg-surface flex cursor-pointer gap-3 rounded-sm border p-3"
                }
              >
                <input
                  type="radio"
                  name="invite-kind"
                  value={each}
                  checked={kind === each}
                  onChange={() => setKind(each)}
                  className="mt-1 shrink-0"
                />
                <span className="flex flex-col gap-1">
                  <span className="font-semibold">
                    {INVITE_KINDS[each].label}
                  </span>
                  <span className="text-muted text-sm">
                    {INVITE_KINDS[each].line}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {chosen !== null && (
        <div className="border-rule flex flex-col gap-2 rounded-sm border p-4 text-sm">
          <p className="font-semibold">Como funciona</p>
          {kinds.length === 1 && <p className="text-muted">{chosen.line}</p>}
          <ol className="text-muted flex list-decimal flex-col gap-1 pl-5">
            {chosen.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {chosen.note !== undefined && (
            <p className="text-muted">{chosen.note}</p>
          )}
        </div>
      )}
      {kind === "organization" ? (
        <InviteForm organizations={offerable} />
      ) : kind === "founder" ? (
        <FounderInviteForm seatsLeft={seatsLeft} />
      ) : (
        <PersonalPlanForm />
      )}
    </div>
  );
}
