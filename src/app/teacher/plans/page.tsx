import type { Metadata } from "next";

import { requirePlatformAdmin } from "@/lib/auth";
import { BRAND_KEYS } from "@/lib/brand";
import { CREDIT_ACTION_LABEL, CREDIT_ACTIONS } from "@/lib/credits/actions";

import { CostForm } from "./cost-form";
import { PlanForm, type PlanFields } from "./plan-form";

export const metadata: Metadata = {
  title: "Planos",
};

/** Cents as the form shows them back: "57,00". */
function reais(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

const EMPTY: PlanFields = {
  id: "",
  brand: "chelsea-st",
  key: "",
  name: "",
  position: 0,
  monthlyPrice: "",
  annualPrice: "",
  monthlyCredits: 0,
  trailMinutesPerDay: 15,
  opensVoiceQuestion: false,
  opensFreeConversation: false,
  opensVideo: false,
  trialDays: 0,
  trialCredits: 0,
  creditCeilingMonths: null,
  creditDaysAfterCancel: null,
  isActive: true,
};

/**
 * The catalog of plans (Q3 of the #72 plan), written by the platform admin
 * alone. Every number of the offer lives in the database, never in the
 * repository (ADR 0006). A plan is taken off sale, never deleted: a
 * subscription points at it.
 */
export default async function PlansPage() {
  const { supabase } = await requirePlatformAdmin();
  const [{ data, error }, { data: costs, error: costsError }] =
    await Promise.all([
      supabase.from("plans").select("*").order("brand").order("position"),
      supabase.from("credit_costs").select("brand, action, credits"),
    ]);
  if (error) throw new Error(`plans: ${error.message}`);
  if (costsError) throw new Error(`credit_costs: ${costsError.message}`);
  const costOf = (brand: string, action: string): number | null =>
    (costs ?? []).find((c) => c.brand === brand && c.action === action)
      ?.credits ?? null;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Planos
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Planos à venda
        </h1>
        <p className="text-muted max-w-prose text-sm">
          O preço mudado aqui vale para as assinaturas novas; quem já assina
          continua com o valor que assinou. Um plano sai de venda, nunca é
          apagado. Os créditos não vencem enquanto a assinatura está viva. Os
          créditos do mês, o teto do saldo e os dias depois do cancelamento
          mudados aqui também valem só para as assinaturas novas.
        </p>
      </div>
      {(data ?? []).map((plan) => (
        <PlanForm
          key={plan.id}
          plan={{
            id: plan.id,
            brand: plan.brand,
            key: plan.key,
            name: plan.name,
            position: plan.position,
            monthlyPrice: reais(plan.monthly_price_cents),
            annualPrice: reais(plan.annual_price_cents),
            monthlyCredits: plan.monthly_credits,
            trailMinutesPerDay: plan.trail_minutes_per_day,
            opensVoiceQuestion: plan.opens_voice_question,
            opensFreeConversation: plan.opens_free_conversation,
            opensVideo: plan.opens_video,
            trialDays: plan.trial_days,
            trialCredits: plan.trial_credits,
            creditCeilingMonths: plan.credit_ceiling_months,
            creditDaysAfterCancel: plan.credit_days_after_cancel,
            isActive: plan.is_active,
          }}
        />
      ))}
      <h2 className="text-xl font-bold">Novo plano</h2>
      <PlanForm plan={EMPTY} />

      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">Custos em créditos</h2>
        <p className="text-muted max-w-prose text-sm">
          Quanto cada coisa custa em créditos, em cada marca. Sem custo, a coisa
          não se vende naquela marca. O custo mudado aqui vale a partir do
          próximo débito. Um custo salvo muda, mas não sai por esta tela.
        </p>
      </div>
      {BRAND_KEYS.map((brand) => (
        <section
          key={brand}
          aria-label={`Custos de ${brand}`}
          className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-4 text-sm"
        >
          <p className="font-semibold">{brand}</p>
          {CREDIT_ACTIONS.map((action) => (
            <CostForm
              key={action}
              brand={brand}
              action={action}
              label={CREDIT_ACTION_LABEL[action]}
              credits={costOf(brand, action)}
            />
          ))}
        </section>
      ))}
    </section>
  );
}
