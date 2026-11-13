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
 * provider.
 */
export async function savePlan(
  _previous: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const { supabase } = await requirePlatformAdmin();
  const read = readPlanForm(formData);
  if (!read.ok) return { status: "error", message: read.message };

  const id = String(formData.get("id") ?? "");
  const { error } =
    id === ""
      ? await supabase.from("plans").insert(read.values)
      : await supabase
          .from("plans")
          .update({ ...read.values, updated_at: new Date().toISOString() })
          .eq("id", id);
  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        message: "Já existe um plano com essa chave nessa marca.",
      };
    }
    return {
      status: "error",
      message: `Não foi possível salvar: ${error.message}`,
    };
  }
  revalidatePath("/teacher/plans");
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
