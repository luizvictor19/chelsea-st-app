"use server";

import { revalidatePath } from "next/cache";

import type { SchoolRole } from "@/lib/access";
import { requireTeacher } from "@/lib/content/queries";
import { looksLikeEmail, normalizeEmail } from "@/lib/credentials";
import { env } from "@/lib/env";
import { inviteRefusal, renewedExpiry } from "@/lib/invites";
import { createInviteMailer } from "@/lib/supabase/admin";

export type InviteState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "joined"; email: string }
  // The typed email and role go back to the form: a refusal must not make the
  // person type them again.
  | { status: "error"; message: string; email?: string; role?: SchoolRole };

export type RowResult =
  | { status: "sent" }
  | { status: "joined" }
  | { status: "cancelled" }
  | { status: "error"; message: string };

const ROLES: readonly SchoolRole[] = ["student", "teacher", "admin"];

/**
 * Sends the email of an invite the database has already accepted. Supabase
 * creates the account here, unconfirmed: the membership waits for the click
 * (0031). The link leads to /definir-senha through the invite template of
 * docs/commands.md.
 */
async function mailInvite(email: string): Promise<string | null> {
  const { error } = await createInviteMailer().inviteUserByEmail(email, {
    redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/definir-senha`,
  });
  if (!error) {
    return null;
  }
  if (error.code === "email_exists") {
    // A confirmed account would have joined when the invite was written, so
    // this one was left open on purpose: she studies at another school, or
    // the two schools invited her at the same moment.
    return "Essa pessoa já tem conta e não entrou por este convite. Ela provavelmente já estuda em outra escola. Fale com ela antes de reenviar.";
  }
  if (error.code === "over_email_send_rate_limit") {
    return "O convite foi gravado, mas o limite de e-mails do Supabase foi atingido. Use Reenviar daqui a alguns minutos.";
  }
  return "O convite foi gravado, mas o e-mail não saiu. A pessoa pode entrar pela tela de login com esse e-mail, em “Entrar com um link por e-mail”, ou você usa Reenviar mais tarde.";
}

type Supabase = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

/**
 * After an invite is written or renewed: either the person already joined
 * (0031 accepts at once for a confirmed email, in a trigger after the write,
 * which the row returned by the write does not show), or the email goes out.
 */
async function joinedOrMailed(
  supabase: Supabase,
  inviteId: string,
  email: string,
): Promise<"joined" | "sent" | { problem: string }> {
  const { data: written } = await supabase
    .from("school_invites")
    .select("accepted_at")
    .eq("id", inviteId)
    .single();
  if (written?.accepted_at) {
    return "joined";
  }
  const problem = await mailInvite(email);
  return problem === null ? "sent" : { problem };
}

/**
 * Writes the invite with the inviter's own client, so RLS decides whether she
 * may (0031), and only then mails it. Someone whose email is already
 * confirmed joins as the row is written: there is nothing to mail.
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

  const { data: invite, error } = await supabase
    .from("school_invites")
    .insert({ school_id: schoolId, email, role })
    .select("id")
    .single();
  if (error) {
    return { status: "error", message: inviteRefusal(error), email, role };
  }

  revalidatePath("/teacher/convites");

  const outcome = await joinedOrMailed(supabase, invite.id, email);
  if (typeof outcome === "object") {
    return { status: "error", message: outcome.problem };
  }
  return { status: outcome, email };
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

  const outcome = await joinedOrMailed(supabase, invite.id, invite.email);
  if (typeof outcome === "object") {
    return { status: "error", message: outcome.problem };
  }
  return { status: outcome };
}

/**
 * Cancels an open invite. The account Supabase created when it was mailed
 * stays, unconfirmed and with no school: signing in with it leads to the
 * "account not released" screen, like any address without an invite.
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
