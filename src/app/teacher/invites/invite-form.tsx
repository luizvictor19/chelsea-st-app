"use client";

import { useActionState, useState } from "react";

import type { OrganizationRole } from "@/lib/access";
import { roleLabel } from "@/lib/invites";

import { inviteToOrganization, type InviteState } from "./actions";

export type InvitableOrganization = {
  readonly id: string;
  readonly name: string;
  /** Whether it has a teacher (0042): it names the roles. */
  readonly hasTeacher: boolean;
  /** The roles the form offers. */
  readonly roles: readonly OrganizationRole[];
  /**
   * The roles whose open invites she may renew and cancel (can_invite,
   * 0031). Wider than roles where the signup is the door (open_signup): a
   * student invite there is no longer offered, but one still open is hers to
   * manage.
   */
  readonly manageRoles: readonly OrganizationRole[];
};

const INITIAL_STATE: InviteState = { status: "idle" };

const fieldClass =
  "border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 outline-none";

export function InviteForm({
  organizations,
}: {
  readonly organizations: readonly InvitableOrganization[];
}) {
  const [state, formAction, isPending] = useActionState(
    inviteToOrganization,
    INITIAL_STATE,
  );
  const [organizationId, setOrganizationId] = useState(organizations[0].id);
  const organization =
    organizations.find((o) => o.id === organizationId) ?? organizations[0];
  // React resets the form when the action ends, refusal included; what the
  // action sends back becomes the default, so a refusal keeps what was typed.
  const kept = state.status === "error" ? state : null;
  const role =
    kept?.role && organization.roles.includes(kept.role)
      ? kept.role
      : organization.roles[0];

  return (
    <form
      action={formAction}
      className="border-rule bg-surface flex flex-col gap-4 rounded-sm border p-6"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-2">
          <label htmlFor="invite-email" className="font-semibold">
            E-mail
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            required
            placeholder="pessoa@exemplo.com"
            defaultValue={kept?.email}
            className={fieldClass}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="invite-role" className="font-semibold">
            Papel
          </label>
          <select
            id="invite-role"
            name="role"
            // Remounted when the organization changes, so it never keeps a role the
            // new organization does not allow.
            key={organization.id}
            defaultValue={role}
            className={fieldClass}
          >
            {organization.roles.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role, organization.hasTeacher)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {organizations.length > 1 ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="invite-organization" className="font-semibold">
            Organização
          </label>
          <select
            id="invite-organization"
            name="organization_id"
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            className={fieldClass}
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="organization_id" value={organization.id} />
      )}

      {state.status === "error" && (
        <p role="alert" className="text-accent text-sm">
          {state.message}
        </p>
      )}
      {state.status === "sent" && (
        <p role="status" className="text-muted text-sm">
          Convite enviado para <span className="font-mono">{state.email}</span>.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="bg-accent text-accent-foreground self-start rounded-sm px-5 py-3 font-semibold disabled:opacity-60"
      >
        {isPending ? "Enviando..." : "Enviar convite"}
      </button>
    </form>
  );
}
