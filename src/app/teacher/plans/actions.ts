"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth";
import { readPlanForm } from "@/lib/billing/plan-form";
import { CREDIT_ACTION_LABEL } from "@/lib/credits/actions";
import { readCostForm } from "@/lib/credits/cost-form";

export type PlanState =
  | { status: "idle" }
  | { status: "saved"; name: string }
  | { status: "error"; message: string };

/**
 * Creates a plan, or changes the one named by id, with the platform admin's
 * own client: plans_insert and plans_update decide (0049). A price changed
 * here reaches new subscriptions only; one that exists keeps its value at the
 * provider, and a founder whose terms are fixed keeps hers (0058).
 *
 * A personal plan (personal=1) is only changed here, never created: it is
 * born on /teacher/invites, for an e-mail. Its update is held to rows that
 * are personal, so the flag cannot turn a public plan's audience away.
 */
export async function savePlan(
  _previous: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const { supabase } = await requirePlatformAdmin();
  const read = readPlanForm(formData);
  if (!read.ok) return { status: "error", message: read.message };

  const id = String(formData.get("id") ?? "");
  const personal = formData.get("personal") === "1";
  if (id === "" && personal) {
    return {
      status: "error",
      message: "Um plano personalizado nasce em Convites.",
    };
  }
  const update = supabase
    .from("plans")
    .update({ ...read.values, updated_at: new Date().toISOString() })
    .eq("id", id);
  const { data: written, error } =
    id === ""
      ? await supabase.from("plans").insert(read.values).select("id")
      : personal
        ? await update.eq("audience", "person").select("id")
        : await update.neq("audience", "person").select("id");
  // An update that reached no row saved nothing: say so, never "salvo".
  if (!error && written.length === 0) {
    return {
      status: "error",
      message: "Este plano mudou em outra aba. Recarregue a página.",
    };
  }
  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        message: "Já existe um plano com essa chave nessa marca.",
      };
    }
    if (error.message.includes("plans_founder_stays_on_sale")) {
      return {
        status: "error",
        message:
          "Este é o único Plano Fundador à venda. Ponha outro à venda antes de tirar este, ou de mudar quem o vê.",
      };
    }
    return {
      status: "error",
      message: `Não foi possível salvar: ${error.message}`,
    };
  }
  revalidatePath("/teacher/plans");
  revalidatePath("/teacher/invites");
  revalidatePath("/dashboard/plano");
  return { status: "saved", name: read.values.name };
}

export type CostState =
  | { status: "idle" }
  | { status: "saved"; label: string }
  | { status: "error"; message: string };

/**
 * Writes what one unit of an action costs in a brand, new or changed, with
 * the platform admin's own client: credit_costs_insert and
 * credit_costs_update decide (0050). The cost is read by credit_cost from
 * here on, the next debit included.
 */
export async function saveCost(
  _previous: CostState,
  formData: FormData,
): Promise<CostState> {
  const { supabase } = await requirePlatformAdmin();
  const read = readCostForm(formData);
  if (!read.ok) return { status: "error", message: read.message };

  const { error } = await supabase
    .from("credit_costs")
    .upsert(
      { ...read.values, updated_at: new Date().toISOString() },
      { onConflict: "brand,action" },
    );
  if (error) {
    return {
      status: "error",
      message: `Não foi possível salvar: ${error.message}`,
    };
  }
  revalidatePath("/teacher/plans");
  return {
    status: "saved",
    label: `${CREDIT_ACTION_LABEL[read.values.action]}: ${read.values.credits}`,
  };
}
