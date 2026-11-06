"use server";

import { revalidatePath } from "next/cache";

import type { OrganizationRole } from "@/lib/access";
import { inviteOptions } from "@/lib/auth-links";
import { isBrandKey, siteOfBrand } from "@/lib/brand";
import { requireTeacher } from "@/lib/content/queries";
import { looksLikeEmail, normalizeEmail } from "@/lib/credentials";
import { currentSite, siteConfig } from "@/lib/current-site";
import { inviteRefusal, mailProblem, renewedExpiry } from "@/lib/invites";
import { createInviteMailer } from "@/lib/supabase/admin";

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

type Client = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

/**
 * Asks Supabase to mail the invite. For a new email it creates the account,
 * unconfirmed: the membership waits for the click (0031), and the link leads
 * to /set-password through the invite template of docs/commands.md. For an
 * account that already exists it mails nothing, and that reads as sent: she
 * accepts when she signs in (0032). See mailProblem.
 *
 * The link leads to the site of the brand the organization wears (#195),
 * read here so both callers get it: a GrifoAI company's invite opens on the
 * GrifoAI domain, whoever sent it and from wherever. A brand with no site yet
 * (no GrifoAI domain before #193) gets no redirect, so the Site URL. When the
 * organization's brand cannot be read, the inviter's site, as before #195.
 */
async function mailInvite(
  supabase: Client,
  email: string,
  organizationId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("organizations")
    .select("brand")
    .eq("id", organizationId)
    .maybeSingle();
  const site = isBrandKey(data?.brand)
    ? siteOfBrand(data.brand, siteConfig())
    : await currentSite();

  const { error } = await createInviteMailer().inviteUserByEmail(
    email,
    inviteOptions(site),
  );
  return mailProblem(error);
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
  const { supabase } = await requireTeacher();

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
    return { status: "error", message: "Escolha o papel e a escola.", email };
  }

  const { error } = await supabase
    .from("organization_invites")
    .insert({ organization_id: organizationId, email, role });
  if (error) {
    return { status: "error", message: inviteRefusal(error), email, role };
  }

  revalidatePath("/teacher/invites");

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
  const { supabase } = await requireTeacher();

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

  revalidatePath("/teacher/invites");

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
  const { supabase } = await requireTeacher();

  const { data, error } = await supabase
    .from("organization_invites")
    .delete()
    .eq("id", inviteId)
    .is("accepted_at", null)
    .select("id");
  if (error) {
    return { status: "error", message: inviteRefusal(error) };
  }

  revalidatePath("/teacher/invites");

  if (data.length === 0) {
    return {
      status: "error",
      message:
        "Esse convite já foi aceito ou cancelado. A lista foi atualizada.",
    };
  }
  return { status: "cancelled" };
}
