import { toStored } from "@/lib/billing/supabase-store";
import type { StoredSubscription } from "@/lib/billing/store";
import type { PlanForSale } from "@/lib/billing/subscribe";
import { summarize, type CreditSummary } from "@/lib/credits/summary";
import { createClient } from "@/lib/supabase/server";

export type PlanOnSale = PlanForSale & { readonly monthlyCredits: number };

/**
 * The person's own billing, read with her own client: row level security
 * gives her the active plans and her own subscriptions, and nothing else.
 */
export async function readPlanScreen(personId: string): Promise<{
  plans: PlanOnSale[];
  current: StoredSubscription | null;
  pastDueSince: string | null;
  trialUsed: boolean;
}> {
  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("billing_customers")
    .select("trial_used_at")
    .eq("person_id", personId)
    .maybeSingle();
  const [{ data: plans, error: plansError }, { data: subs, error: subsError }] =
    await Promise.all([
      supabase
        .from("plans")
        .select(
          "id, name, monthly_price_cents, annual_price_cents, trial_days, monthly_credits",
        )
        .eq("brand", "chelsea-st")
        .eq("is_active", true)
        .order("position"),
      supabase
        .from("subscriptions")
        .select("*")
        .eq("person_id", personId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
  if (plansError) throw new Error(`plans: ${plansError.message}`);
  if (subsError) throw new Error(`subscriptions: ${subsError.message}`);
  const row = subs?.[0] ?? null;
  return {
    plans: (plans ?? []).map((plan) => ({
      id: plan.id,
      name: plan.name,
      monthlyPriceCents: plan.monthly_price_cents,
      annualPriceCents: plan.annual_price_cents,
      trialDays: plan.trial_days,
      monthlyCredits: plan.monthly_credits,
    })),
    current: row === null ? null : toStored(row),
    pastDueSince: row?.past_due_since ?? null,
    trialUsed: customer?.trial_used_at != null,
  };
}

/** The plan by its id, active and on sale; null otherwise. */
export async function readPlanForSale(
  planId: string,
): Promise<PlanForSale | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select("id, name, monthly_price_cents, annual_price_cents, trial_days")
    .eq("id", planId)
    .eq("brand", "chelsea-st")
    .eq("is_active", true)
    .maybeSingle();
  return data === null
    ? null
    : {
        id: data.id,
        name: data.name,
        monthlyPriceCents: data.monthly_price_cents,
        annualPriceCents: data.annual_price_cents,
        trialDays: data.trial_days,
      };
}

/**
 * Her live lots, read with her own client. credit_live_lots is security
 * definer (0050): what keeps it to her is credit_check_reader, which refuses
 * anyone signed in asking for another person, not row level security.
 */
export async function readCredits(personId: string): Promise<CreditSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("credit_live_lots", {
    p_person: personId,
  });
  if (error) throw new Error(`credit_live_lots: ${error.message}`);
  return summarize(
    (data ?? []).map((lot) => ({
      remaining: lot.remaining,
      expiresAt: lot.expires_at,
    })),
  );
}
