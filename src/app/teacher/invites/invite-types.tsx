"use client";

import { useState } from "react";

import { InviteForm, type InvitableOrganization } from "./invite-form";
import { PersonalPlanForm } from "./personal-plan-form";

/**
 * The one invite screen (#292, 13/11): the kind first, then its form. An
 * invite to an organization, as before; a Plano Fundador Personalizado, for
 * the platform admin alone. #296 adds the founder's invite here.
 */
export function InviteTypes({
  organizations,
  platformAdmin,
}: {
  readonly organizations: readonly InvitableOrganization[];
  readonly platformAdmin: boolean;
}) {
  const kinds = [
    ...(organizations.length > 0
      ? [{ key: "organization", label: "Organização" } as const]
      : []),
    ...(platformAdmin
      ? [{ key: "personal", label: "Plano personalizado" } as const]
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
        <InviteForm organizations={organizations} />
      ) : (
        <PersonalPlanForm />
      )}
    </div>
  );
}
