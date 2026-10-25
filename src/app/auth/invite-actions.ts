"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { acceptRefusal } from "@/lib/invites";
import { createClient } from "@/lib/supabase/server";

export type AcceptState =
  { status: "idle" } | { status: "error"; message: string };

/**
 * Says yes to one invite, with the person's own client: accept_my_school_invite
 * (0032) checks that it is her confirmed email, open and in time. Then the
 * front door decides where someone with a new role belongs.
 */
export async function acceptInvite(
  _previous: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const inviteId = String(formData.get("invite_id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_my_school_invite", {
    p_invite: inviteId,
  });
  if (error) {
    return { status: "error", message: acceptRefusal(error) };
  }

  // The new role changes the teacher layout too (the notice, "Ver como aluna"),
  // and the redirect alone may reuse it.
  revalidatePath("/", "layout");
  redirect("/");
}
