import { AUDIENCE_LABEL } from "../../../lib/badges.ts";
import type { PlanFields } from "./plan-form.tsx";

/**
 * What the card of a saved plan says before it is opened (#360): who sees
 * it, its prices, its credits, its lesson, the trail, the trial and whether
 * it is on sale. The numbers are the database's, as the form shows them.
 */
export type PlanSummary = {
  readonly title: string;
  readonly parts: readonly string[];
};

function credits(n: number): string {
  return n === 1 ? "1 crédito" : `${n} créditos`;
}

export function planSummary(plan: PlanFields): PlanSummary {
  const audience =
    plan.brand === "chelsea-st"
      ? AUDIENCE_LABEL[plan.audience]
      : `${AUDIENCE_LABEL[plan.audience]} · ${plan.brand}`;
  const price =
    plan.annualPrice === ""
      ? `R$ ${plan.monthlyPrice} por mês, só mensal`
      : `R$ ${plan.monthlyPrice} por mês ou R$ ${plan.annualPrice} por ano`;
  const parts = [
    audience,
    price,
    `${credits(plan.monthlyCredits)} por mês`,
    plan.teacherLessonCredits === null
      ? "aula: custo da marca"
      : `aula: ${credits(plan.teacherLessonCredits)}`,
    plan.trailMinutesPerDay === 0
      ? "sem trilha"
      : `${plan.trailMinutesPerDay} min de trilha por dia`,
    ...(plan.trialDays > 0 ? [`${plan.trialDays} dias de teste`] : []),
    plan.isActive ? "à venda" : "fora de venda",
  ];
  return { title: plan.name, parts };
}
