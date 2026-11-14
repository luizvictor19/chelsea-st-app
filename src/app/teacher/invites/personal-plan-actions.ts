"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth";
import { siteOfBrand } from "@/lib/brand";
import { siteConfig } from "@/lib/current-site";
import { createResendMailer, type Mailer } from "@/lib/mail/mailer";
import {
  invitePersonalPlan as invite,
  mailPersonalPlan,
  personalKey,
  type PersonalInvite,
} from "@/lib/personal-plan-invite";
import { PERSONAL_PLAN_FROM } from "@/lib/personal-plan-mail";

import type { RowResult } from "./actions";

export type PersonalPlanState = { status: "idle" } | PersonalInvite;

/** The mailer of agenda@, or null without a key: the plan is kept anyway. */
function mailer(): Mailer | null {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  return apiKey === ""
    ? null
    : createResendMailer({ apiKey, from: PERSONAL_PLAN_FROM });
}

/** The links go to the site of the brand that sells the plan. */
function origin(): string | null {
  return siteOfBrand("chelsea-st", siteConfig())?.origin ?? null;
}

function refresh(): void {
  revalidatePath("/teacher/founders");
  revalidatePath("/teacher/plans");
}

/**
 * A Plano Fundador Personalizado for one e-mail (#292): written with the
 * platform admin's own client (plans_insert, 0058 binds it at once to a
 * confirmed account with that e-mail), then mailed from agenda@.
 */
export async function invitePersonalPlan(
  _previous: PersonalPlanState,
  formData: FormData,
): Promise<PersonalPlanState> {
  const { supabase } = await requirePlatformAdmin();
  const result = await invite(
    {
      insert: async (row) => {
        const { error } = await supabase.from("plans").insert(row);
        return error === null
          ? { ok: true }
          : { ok: false, code: error.code, message: error.message };
      },
      mailer: mailer(),
      origin: origin(),
      newKey: () => personalKey(randomBytes(4)),
    },
    formData,
  );
  if (result.status !== "error") refresh();
  return result;
}

/** The e-mail of a personal plan still waiting for its account, again. */
export async function resendPersonalPlan(planId: string): Promise<RowResult> {
  const { supabase } = await requirePlatformAdmin();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("name, person_email")
    .eq("id", planId)
    .eq("audience", "person")
    .eq("is_active", true)
    .is("person_id", null)
    .maybeSingle();
  if (error || plan === null || plan.person_email === null) {
    refresh();
    return {
      status: "error",
      message:
        "Esse plano já foi ligado a uma conta ou saiu de venda. A lista foi atualizada.",
    };
  }
  const problem = await mailPersonalPlan(
    { mailer: mailer(), origin: origin() },
    { email: plan.person_email, name: plan.name },
  );
  return problem === null
    ? { status: "sent" }
    : { status: "error", message: problem };
}

/**
 * Takes a personal plan off sale: it disappears for its person, and its
 * e-mail no longer leads anywhere. The list asks before sending this.
 */
export async function endPersonalPlan(planId: string): Promise<RowResult> {
  const { supabase } = await requirePlatformAdmin();
  const { data, error } = await supabase
    .from("plans")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", planId)
    .eq("audience", "person")
    .select("id");
  refresh();
  if (error || data.length === 0) {
    return {
      status: "error",
      message:
        "Não foi possível tirar o plano de venda. A lista foi atualizada.",
    };
  }
  return { status: "cancelled" };
}
