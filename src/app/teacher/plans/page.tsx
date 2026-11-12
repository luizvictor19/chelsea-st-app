import type { Metadata } from "next";

import { requirePlatformAdmin } from "@/lib/auth";

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
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .order("brand")
    .order("position");
  if (error) throw new Error(`plans: ${error.message}`);

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
          apagado.
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
            isActive: plan.is_active,
          }}
        />
      ))}
      <h2 className="text-xl font-bold">Novo plano</h2>
      <PlanForm plan={EMPTY} />
    </section>
  );
}
