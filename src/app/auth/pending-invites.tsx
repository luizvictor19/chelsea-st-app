import { ROLE_LABEL } from "@/lib/invites";
import { createClient } from "@/lib/supabase/server";

import { AcceptInviteForm } from "./accept-invite-form";

/**
 * The open invites of the signed-in person, each with "Aceitar". Since 0032
 * someone who already has an account joins another school, or takes another
 * role, only by saying yes here: Supabase mails her no invite. Renders nothing
 * when there is none.
 */
export async function PendingInvites() {
  const supabase = await createClient();
  const { data: invites } = await supabase.rpc("my_open_school_invites");
  if (!invites || invites.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Convites"
      className="border-accent bg-surface flex flex-col gap-4 rounded-sm border p-5"
    >
      {invites.map((invite) => (
        <div
          key={invite.id}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p>
            Você foi convidada para a{" "}
            <span className="font-semibold">{invite.school_name}</span> como{" "}
            <span className="font-semibold">{ROLE_LABEL[invite.role]}</span>.
          </p>
          <AcceptInviteForm inviteId={invite.id} />
        </div>
      ))}
    </section>
  );
}
