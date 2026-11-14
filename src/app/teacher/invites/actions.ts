"use server";

import { revalidatePath } from "next/cache";

import type { OrganizationRole } from "@/lib/access";
import { requireInviter } from "@/lib/auth";
import { looksLikeEmail, normalizeEmail } from "@/lib/credentials";
import { inviteRefusal, renewedExpiry } from "@/lib/invites";

import { mailInvite } from "./mail-invite";

export type InviteState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  // The typed email and role go back to the form: a refusal must not make the
  // person type them again.
  | {
      status: "error";
      message: string;
      email?: string;
      role?: OrganizationRole;
    };

export type RowResult =
  | { status: "sent" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

const ROLES: readonly OrganizationRole[] = ["student", "teacher", "admin"];

/** Both screens that list invites: the teacher's and the company admin's (0042). */
function refreshInviteScreens(): void {
  revalidatePath("/teacher/invites");
  revalidatePath("/teacher/organizations");
  revalidatePath("/team");
}

/**
 * Writes the invite with the inviter's own client, so RLS decides whether she
 * may (0031), and only then mails it. Nobody joins here: every invite waits
 * for the person's yes (0032).
 */
export async function inviteToOrganization(
  _previous: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const { supabase } = await requireInviter();

  const email = normalizeEmail(formData.get("email"));
  const role = String(formData.get("role") ?? "") as OrganizationRole;
  const organizationId = String(formData.get("organization_id") ?? "");

  if (!looksLikeEmail(email)) {
    return {
      status: "error",
      message: "Digite um e-mail válido.",
      email,
      role,
    };
  }
  if (!ROLES.includes(role) || organizationId === "") {
    return {
      status: "error",
      message: "Escolha o papel e a organização.",
      email,
    };
  }

  const { error } = await supabase
    .from("organization_invites")
    .insert({ organization_id: organizationId, email, role });
  if (error) {
    return { status: "error", message: inviteRefusal(error), email, role };
  }

  refreshInviteScreens();

  const problem = await mailInvite(supabase, email, organizationId);
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
  const { supabase } = await requireInviter();

  const { data: invite, error } = await supabase
    .from("organization_invites")
    .update({ expires_at: renewedExpiry(new Date()) })
    .eq("id", inviteId)
    .is("accepted_at", null)
    .select("id, email, organization_id")
    .maybeSingle();
  if (error) {
    return { status: "error", message: inviteRefusal(error) };
  }

  refreshInviteScreens();

  if (!invite) {
    return {
      status: "error",
      message:
        "Esse convite já foi aceito ou cancelado. A lista foi atualizada.",
    };
  }

  const problem = await mailInvite(
    supabase,
    invite.email,
    invite.organization_id,
  );
  if (problem !== null) {
    return { status: "error", message: problem };
  }
  return { status: "sent" };
}

/**
 * Cancels an open invite. The account Supabase created when it was mailed
 * stays, unconfirmed and with no organization. Its only way in is the recovery link
 * ("Esqueci minha senha", or the magic link, which falls back to it): that
 * confirms the email with no invite left to accept, and leads to the screen
 * of an account with no access.
 */
export async function cancelInvite(inviteId: string): Promise<RowResult> {
  const { supabase } = await requireInviter();

  const { data, error } = await supabase
    .from("organization_invites")
    .delete()
    .eq("id", inviteId)
    .is("accepted_at", null)
    .select("id");
  if (error) {
    return { status: "error", message: inviteRefusal(error) };
  }

  refreshInviteScreens();

  if (data.length === 0) {
    return {
      status: "error",
      message:
        "Esse convite já foi aceito ou cancelado. A lista foi atualizada.",
    };
  }
  return { status: "cancelled" };
}
