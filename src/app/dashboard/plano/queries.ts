import { withFounderTerms, type SealTerms } from "@/lib/billing/founder-terms";
import { billingStore } from "@/lib/billing/server";
import { toStored } from "@/lib/billing/supabase-store";
import type { StoredSubscription } from "@/lib/billing/store";
import type { PlanForSale } from "@/lib/billing/subscribe";
import { summarize, type CreditSummary } from "@/lib/credits/summary";
import type { RefundOffer, RefundRequestShown } from "./refund-card";
import { createClient } from "@/lib/supabase/server";

export type PlanOnSale = PlanForSale & {
  readonly monthlyCredits: number;
  readonly audience: string;
  /** Null: the brand's cost of a lesson. */
  readonly teacherLessonCredits: number | null;
};

export type FounderSeal = SealTerms & { readonly grantedAt: string };

type Client = Awaited<ReturnType<typeof createClient>>;

const PLAN_COLUMNS =
  "id, name, monthly_price_cents, annual_price_cents, trial_days, monthly_credits, audience, teacher_lesson_credits";

/** Her live Founder seal and its terms, read with her own client (0058). */
async function readSeal(
  supabase: Client,
  personId: string,
): Promise<FounderSeal | null> {
  const { data, error } = await supabase
    .from("person_badges")
    .select(
      "granted_at, terms_fixed_at, terms_monthly_price_cents, terms_annual_price_cents, terms_monthly_credits, terms_teacher_lesson_credits",
    )
    .eq("person_id", personId)
    .eq("badge", "founder")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(`person_badges: ${error.message}`);
  return data === null
    ? null
    : {
        grantedAt: data.granted_at,
        termsFixedAt: data.terms_fixed_at,
        monthlyPriceCents: data.terms_monthly_price_cents,
        annualPriceCents: data.terms_annual_price_cents,
        monthlyCredits: data.terms_monthly_credits,
        teacherLessonCredits: data.terms_teacher_lesson_credits,
      };
}

type PlanRow = {
  id: string;
  name: string;
  monthly_price_cents: number;
  annual_price_cents: number;
  trial_days: number;
  monthly_credits: number;
  audience: string;
  teacher_lesson_credits: number | null;
};

function onSale(plan: PlanRow, seal: FounderSeal | null): PlanOnSale {
  return withFounderTerms(
    {
      id: plan.id,
      name: plan.name,
      monthlyPriceCents: plan.monthly_price_cents,
      annualPriceCents: plan.annual_price_cents,
      trialDays: plan.trial_days,
      monthlyCredits: plan.monthly_credits,
      audience: plan.audience,
      teacherLessonCredits: plan.teacher_lesson_credits,
    },
    seal,
  );
}

/**
 * The person's own billing, read with her own client: row level security
 * gives her the active public plans, the Plano Fundador while she holds a
 * live seal and the personal plan bound to her (0058), her own
 * subscriptions, and nothing else. On the Plano Fundador her terms, once
 * fixed, stand for the plan's numbers.
 */
export async function readPlanScreen(personId: string): Promise<{
  plans: PlanOnSale[];
  current: StoredSubscription | null;
  pastDueSince: string | null;
  trialUsed: boolean;
  seal: FounderSeal | null;
}> {
  const supabase = await createClient();
  const [{ data: customer }, seal] = await Promise.all([
    supabase
      .from("billing_customers")
      .select("trial_used_at")
      .eq("person_id", personId)
      .maybeSingle(),
    readSeal(supabase, personId),
  ]);
  const [{ data: plans, error: plansError }, { data: subs, error: subsError }] =
    await Promise.all([
      supabase
        .from("plans")
        .select(PLAN_COLUMNS)
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
    plans: (plans ?? []).map((plan) => onSale(plan, seal)),
    current: row === null ? null : toStored(row),
    pastDueSince: row?.past_due_since ?? null,
    trialUsed: customer?.trial_used_at != null,
    seal,
  };
}

/**
 * The plan by its id, active and on sale to her (row level security), with
 * her founder's terms on the Plano Fundador; null otherwise.
 */
export async function readPlanForSale(
  planId: string,
  personId: string,
): Promise<PlanForSale | null> {
  const supabase = await createClient();
  const [{ data }, seal] = await Promise.all([
    supabase
      .from("plans")
      .select(PLAN_COLUMNS)
      .eq("id", planId)
      .eq("brand", "chelsea-st")
      .eq("is_active", true)
      .maybeSingle(),
    readSeal(supabase, personId),
  ]);
  return data === null ? null : onSale(data, seal);
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

/** How long a finished request (done or failed) stays on the screen. */
const REFUND_SHOWN_DAYS = 14;

/**
 * Her withdrawal (#297): what the database would give back now, if a charge
 * of hers is in the window (billing_refund_quote, through the service role:
 * the database decides the window and the value, 0060), and her latest
 * request, read with her own client (row level security). A finished
 * request leaves the screen after REFUND_SHOWN_DAYS.
 */
export async function readRefund(personId: string): Promise<{
  offer: RefundOffer | null;
  request: RefundRequestShown | null;
}> {
  const supabase = await createClient();
  const [{ data, error }, offer] = await Promise.all([
    supabase
      .from("refund_requests")
      .select("status, refund_cents, created_at")
      .eq("person_id", personId)
      .order("created_at", { ascending: false })
      .limit(1),
    billingStore()
      .refundQuote(personId)
      .catch((cause: unknown) => {
        console.error(`refund quote ${personId}: ${String(cause)}`);
        return null;
      }),
  ]);
  if (error) throw new Error(`refund_requests: ${error.message}`);
  const row = data?.[0];
  const shownSince = Date.now() - REFUND_SHOWN_DAYS * 86_400_000;
  const request =
    row === undefined ||
    ((row.status === "done" || row.status === "failed") &&
      Date.parse(row.created_at) < shownSince)
      ? null
      : {
          status: row.status as RefundRequestShown["status"],
          refundCents: row.refund_cents,
        };
  return {
    offer:
      offer === null
        ? null
        : {
            refundCents: offer.refundCents,
            endsAt: offer.endsAt,
            lessonsAhead: offer.lessonsAhead,
          },
    request,
  };
}
