"use client";

import { useActionState } from "react";

import { acceptInvite, type AcceptState } from "./invite-actions";

const INITIAL_STATE: AcceptState = { status: "idle" };

/** One invite's "Aceitar", with the refusal said under it. */
export function AcceptInviteForm({ inviteId }: { readonly inviteId: string }) {
  const [state, formAction, isPending] = useActionState(
    acceptInvite,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="invite_id" value={inviteId} />
      <button
        type="submit"
        disabled={isPending}
        className="bg-accent text-accent-foreground rounded-sm px-4 py-2 text-sm font-semibold disabled:opacity-60"
      >
        {isPending ? "Aceitando…" : "Aceitar"}
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-accent text-sm">
          {state.message}
        </p>
      )}
    </form>
  );
}
