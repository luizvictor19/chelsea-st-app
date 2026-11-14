import type { Metadata } from "next";
import Link from "next/link";

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
  teacherLessonCredits: null,
  audience: "public",
  isActive: true,
};

type PlanRow = {
  id: string;
  brand: string;
  key: string;
  name: string;
  position: number;
  monthly_price_cents: number;
  /** Null: no annual cycle (0062). */
  annual_price_cents: number | null;
  monthly_credits: number;
  trail_minutes_per_day: number;
  opens_voice_question: boolean;
  opens_free_conversation: boolean;
  opens_video: boolean;
  trial_days: number;
  trial_credits: number;
  credit_ceiling_months: number;
  credit_days_after_cancel: number;
  teacher_lesson_credits: number | null;
  audience: string;
  is_active: boolean;
};

function fieldsOf(plan: PlanRow): PlanFields {
  return {
    id: plan.id,
    brand: plan.brand,
    key: plan.key,
    name: plan.name,
    position: plan.position,
    monthlyPrice: reais(plan.monthly_price_cents),
    annualPrice:
      plan.annual_price_cents === null ? "" : reais(plan.annual_price_cents),
    monthlyCredits: plan.monthly_credits,
    trailMinutesPerDay: plan.trail_minutes_per_day,
    opensVoiceQuestion: plan.opens_voice_question,
    opensFreeConversation: plan.opens_free_conversation,
    opensVideo: plan.opens_video,
    trialDays: plan.trial_days,
    trialCredits: plan.trial_credits,
    creditCeilingMonths: plan.credit_ceiling_months,
    creditDaysAfterCancel: plan.credit_days_after_cancel,
    teacherLessonCredits: plan.teacher_lesson_credits,
    audience:
      plan.audience === "founder" || plan.audience === "person"
        ? plan.audience
        : "public",
    isActive: plan.is_active,
  };
}

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
  const catalog = (data ?? []).filter((plan) => plan.audience !== "person");
  const personal = (data ?? []).filter((plan) => plan.audience === "person");
  const boundIds = personal.flatMap((plan) =>
    plan.person_id === null ? [] : [plan.person_id],
  );
  const { data: people, error: peopleError } =
    boundIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", boundIds);
  if (peopleError) throw new Error(`profiles: ${peopleError.message}`);
  const nameOf = (id: string): string =>
    people?.find((person) => person.id === id)?.full_name ?? "conta ligada";
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
          créditos do mês, o teto do saldo, os dias depois do cancelamento e o
          custo da aula mudados aqui também valem só para as assinaturas novas.
          Um plano “Só fundadores” aparece só para quem tem o selo; o último
          deles à venda não sai de venda. Quem já tem o preço de fundador
          guardado continua com ele quando volta.
        </p>
        <Link
          href="/teacher/founders"
          className="text-accent self-start font-semibold underline"
        >
          Fundadores
        </Link>
      </div>
      {catalog.map((plan) => (
        <PlanForm key={plan.id} plan={fieldsOf(plan)} />
      ))}
      <h2 className="text-xl font-bold">Novo plano</h2>
      <PlanForm plan={EMPTY} />

      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">Personalizados</h2>
        <p className="text-muted max-w-prose text-sm">
          Cada Plano Fundador Personalizado é de uma pessoa só. Ele nasce em
          Convites, para um e-mail; aqui mudam os números, não a pessoa.
        </p>
      </div>
      {personal.length === 0 ? (
        <p className="text-muted text-sm">Nenhum plano personalizado.</p>
      ) : (
        personal.map((plan) => (
          <div key={plan.id} className="flex flex-col gap-2">
            <p className="text-sm">
              Para{" "}
              {plan.person_id === null ? (
                <>
                  <span className="font-mono">{plan.person_email}</span> ·
                  aguardando cadastro
                </>
              ) : (
                <span className="font-semibold">{nameOf(plan.person_id)}</span>
              )}
            </p>
            <PlanForm plan={fieldsOf(plan)} />
          </div>
        ))
      )}

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
