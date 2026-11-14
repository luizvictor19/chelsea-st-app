"use client";

import { useState } from "react";

import { FounderInviteForm } from "./founder-invite-form";
import { InviteForm, type InvitableOrganization } from "./invite-form";
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
  const kinds = [
    ...(offerable.length > 0
      ? [{ key: "organization", label: "Organização" } as const]
      : []),
    ...(platformAdmin
      ? ([
          { key: "founder", label: "Fundador" },
          { key: "personal", label: "Plano personalizado" },
        ] as const)
      : []),
  ];
  const [kind, setKind] = useState(kinds[0]?.key);

  if (kinds.length === 0) {
    return <p className="text-muted">Você não pode convidar ninguém.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {kinds.length > 1 && (
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-2 font-semibold">Tipo de convite</legend>
          {kinds.map((each) => (
            <label key={each.key} className="flex items-center gap-2">
              <input
                type="radio"
                name="invite-kind"
                value={each.key}
                checked={kind === each.key}
                onChange={() => setKind(each.key)}
              />
              {each.label}
            </label>
          ))}
        </fieldset>
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
