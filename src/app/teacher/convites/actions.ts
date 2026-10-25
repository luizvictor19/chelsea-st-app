"use server";

import { revalidatePath } from "next/cache";

import type { SchoolRole } from "@/lib/access";
import { requireTeacher } from "@/lib/content/queries";
import { looksLikeEmail, normalizeEmail } from "@/lib/credentials";
import { env } from "@/lib/env";
import { inviteRefusal, mailProblem, renewedExpiry } from "@/lib/invites";
import { createInviteMailer } from "@/lib/supabase/admin";

export type InviteState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  // The typed email and role go back to the form: a refusal must not make the
  // person type them again.
  | { status: "error"; message: string; email?: string; role?: SchoolRole };

export type RowResult =
  | { status: "sent" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

const ROLES: readonly SchoolRole[] = ["student", "teacher", "admin"];

/**
 * Asks Supabase to mail the invite. For a new email it creates the account,
 * unconfirmed: the membership waits for the click (0031), and the link leads
 * to /definir-senha through the invite template of docs/commands.md. For an
 * account that already exists it mails nothing, and that reads as sent: she
 * accepts when she signs in (0032). See mailProblem.
 */
async function mailInvite(email: string): Promise<string | null> {
  const { error } = await createInviteMailer().inviteUserByEmail(email, {
    redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/definir-senha`,
  });
  return mailProblem(error);
}

/**
 * Writes the invite with the inviter's own client, so RLS decides whether she
 * may (0031), and only then mails it. Nobody joins here: every invite waits
 * for the person's yes (0032).
 */
export async function inviteToSchool(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const { supabase } = await requireTeacher();

  const email = normalizeEmail(formData.get("email"));
  const role = String(formData.get("role") ?? "") as SchoolRole;
  const schoolId = String(formData.get("school_id") ?? "");

  if (!looksLikeEmail(email)) {
    return {
      status: "error",
      message: "Digite um e-mail válido.",
      email,
      role,
    };
  }
  if (!ROLES.includes(role) || schoolId === "") {
    return { status: "error", message: "Escolha o papel e a escola.", email };
  }

  const { error } = await supabase
    .from("school_invites")
    .insert({ school_id: schoolId, email, role });
  if (error) {
    return { status: "error", message: inviteRefusal(error), email, role };
  }

  revalidatePath("/teacher/convites");

  const problem = await mailInvite(email);
  if (problem !== null) {
    return { status: "error", message: problem };
  }
  return { status: "sent", email };
}

/**
 * Opens the invite for another 15 days and mails it again. The database
 * restarts the 15 days itself; the value sent is only what it would be.
 */
export async function resendInvite(inviteId: string): Promise<RowResult> {
  const { supabase } = await requireTeacher();

  const { data: invite, error } = await supabase
    .from("school_invites")
    .update({ expires_at: renewedExpiry(new Date()) })
    .eq("id", inviteId)
    .is("accepted_at", null)
    .select("id, email")
    .maybeSingle();
  if (error) {
    return { status: "error", message: inviteRefusal(error) };
  }

  revalidatePath("/teacher/convites");

  if (!invite) {
    return {
      status: "error",
      message:
        "Esse convite já foi aceito ou cancelado. A lista foi atualizada.",
    };
  }

  const problem = await mailInvite(invite.email);
  if (problem !== null) {
    return { status: "error", message: problem };
  }
  return { status: "sent" };
}

/**
 * Cancels an open invite. The account Supabase created when it was mailed
 * stays, unconfirmed and with no school. Its only way in is the recovery link
 * ("Esqueci minha senha", or the magic link, which falls back to it): that
 * confirms the email with no invite left to accept, and leads to the screen
 * of an account with no access.
 */
export async function cancelInvite(inviteId: string): Promise<RowResult> {
  const { supabase } = await requireTeacher();

  const { data, error } = await supabase
    .from("school_invites")
    .delete()
    .eq("id", inviteId)
    .is("accepted_at", null)
    .select("id");
  if (error) {
    return { status: "error", message: inviteRefusal(error) };
  }

  revalidatePath("/teacher/convites");

  if (data.length === 0) {
    return {
      status: "error",
      message:
        "Esse convite já foi aceito ou cancelado. A lista foi atualizada.",
    };
  }
  return { status: "cancelled" };
}
