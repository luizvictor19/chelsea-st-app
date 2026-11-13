"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth";
import { siteOfBrand } from "@/lib/brand";
import { siteConfig } from "@/lib/current-site";
import {
  expiresAt,
  finishFounderInvite,
  founderInviteRefusal,
  inviteFounder as invite,
  spanInDays,
  type FounderInviteState,
} from "@/lib/founder-invite";
import { FOUNDER_INVITE_FROM } from "@/lib/founder-invite-mail";
import { createResendMailer, type Mailer } from "@/lib/mail/mailer";

import type { RowResult } from "./actions";

/** The mailer of agenda@, or null without a key: the invite is kept anyway. */
function mailer(): Mailer | null {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  return apiKey === ""
    ? null
    : createResendMailer({ apiKey, from: FOUNDER_INVITE_FROM });
}

/** The founder offer is Chelsea St's alone (ADR 0007): its site. */
function origin(): string | null {
  return siteOfBrand("chelsea-st", siteConfig())?.origin ?? null;
}

function refresh(): void {
  revalidatePath("/teacher/invites");
  revalidatePath("/teacher/founders");
}

/**
 * A founder invite for one e-mail (#296), written with the platform admin's
 * own client (founder_invites_insert). For an account already confirmed with
 * it, the database gives the seal as it writes, or refuses with no seat.
 */
export async function inviteFounder(
  _previous: FounderInviteState,
  formData: FormData,
): Promise<FounderInviteState> {
  const { supabase } = await requirePlatformAdmin();
  const result = await invite(
    {
      insert: async (row) => {
        const { data, error } = await supabase
          .from("founder_invites")
          .insert(row)
          .select("id")
          .single();
        return error === null
          ? { ok: true, id: data.id }
          : { ok: false, error };
      },
      accepted: async (id) => {
        const { data } = await supabase
          .from("founder_invites")
          .select("accepted_at")
          .eq("id", id)
          .maybeSingle();
        return data?.accepted_at != null;
      },
      mailer: mailer(),
      origin: origin(),
      now: () => new Date(),
    },
    formData,
  );
  if (result.status !== "error") refresh();
  return result;
}

/**
 * Renews an open founder invite by as many days as it was written for, and
 * mails it again. Renewing an invite for an e-mail confirmed since gives the
 * seal now (founder_invites_grant_confirmed), and the mail says so.
 */
export async function resendFounderInvite(
  inviteId: string,
): Promise<RowResult> {
  const { supabase } = await requirePlatformAdmin();
  const { data: row } = await supabase
    .from("founder_invites")
    .select("email, created_at, expires_at")
    .eq("id", inviteId)
    .is("accepted_at", null)
    .maybeSingle();
  if (row === null) {
    refresh();
    return {
      status: "error",
      message:
        "Esse convite já foi aceito ou cancelado. A lista foi atualizada.",
    };
  }
  const { error } = await supabase
    .from("founder_invites")
    .update({
      expires_at: expiresAt(
        new Date(),
        spanInDays(row.created_at, row.expires_at),
      ),
    })
    .eq("id", inviteId);
  if (error) {
    return { status: "error", message: founderInviteRefusal(error) };
  }
  const { data: after } = await supabase
    .from("founder_invites")
    .select("accepted_at")
    .eq("id", inviteId)
    .maybeSingle();
  refresh();
  const state = await finishFounderInvite(
    { mailer: mailer(), origin: origin() },
    { email: row.email, granted: after?.accepted_at != null },
  );
  return state.status === "sent"
    ? { status: "sent" }
    : {
        status: "error",
        message:
          "O convite foi renovado, mas o e-mail não saiu. Mande o link do cadastro à mão.",
      };
}

/** Cancels an open founder invite: founder_invites_cancel takes open ones only. */
export async function cancelFounderInvite(
  inviteId: string,
): Promise<RowResult> {
  const { supabase } = await requirePlatformAdmin();
  const { data, error } = await supabase
    .from("founder_invites")
    .delete()
    .eq("id", inviteId)
    .select("id");
  refresh();
  if (error || data.length === 0) {
    return {
      status: "error",
      message:
        "Não foi possível cancelar: o convite já foi aceito ou cancelado. A lista foi atualizada.",
    };
  }
  return { status: "cancelled" };
}
