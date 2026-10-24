"use client";

import { useActionState, useState } from "react";

import type { SchoolRole } from "@/lib/access";
import { ROLE_LABEL } from "@/lib/invites";

import { inviteToSchool, type InviteState } from "./actions";

export type InvitableSchool = {
  readonly id: string;
  readonly name: string;
  readonly roles: readonly SchoolRole[];
};

const INITIAL_STATE: InviteState = { status: "idle" };

const fieldClass =
  "border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 outline-none";

export function InviteForm({
  schools,
}: {
  readonly schools: readonly InvitableSchool[];
}) {
  const [state, formAction, isPending] = useActionState(
    inviteToSchool,
    INITIAL_STATE,
  );
  const [schoolId, setSchoolId] = useState(schools[0].id);
  const school = schools.find((s) => s.id === schoolId) ?? schools[0];

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
            // Remounted when the school changes, so it never keeps a role the
            // new school does not allow.
            key={school.id}
            defaultValue={school.roles[0]}
            className={fieldClass}
          >
            {school.roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {schools.length > 1 ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="invite-school" className="font-semibold">
            Escola
          </label>
          <select
            id="invite-school"
            name="school_id"
            value={schoolId}
            onChange={(event) => setSchoolId(event.target.value)}
            className={fieldClass}
          >
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="school_id" value={school.id} />
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
      {state.status === "joined" && (
        <p role="status" className="text-muted text-sm">
          <span className="font-mono">{state.email}</span> já tinha conta e
          entrou na escola agora.
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
