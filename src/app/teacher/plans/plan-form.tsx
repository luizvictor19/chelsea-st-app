"use client";

import { useActionState } from "react";

import { savePlan, type PlanState } from "./actions";

const INITIAL: PlanState = { status: "idle" };

const fieldClass =
  "border-rule bg-surface focus:border-accent rounded-sm border px-3 py-2 outline-none";

export type PlanFields = {
  readonly id: string;
  readonly brand: string;
  readonly key: string;
  readonly name: string;
  readonly position: number;
  readonly monthlyPrice: string;
  readonly annualPrice: string;
  readonly monthlyCredits: number;
  readonly trailMinutesPerDay: number;
  readonly opensVoiceQuestion: boolean;
  readonly opensFreeConversation: boolean;
  readonly opensVideo: boolean;
  readonly trialDays: number;
  readonly trialCredits: number;
  readonly carryoverPercent: number;
  readonly isActive: boolean;
};

/** One plan, new (id "") or existing, every number of the offer in one form. */
export function PlanForm({ plan }: { readonly plan: PlanFields }) {
  const [state, formAction, isPending] = useActionState(savePlan, INITIAL);

  return (
    <form
      action={formAction}
      className="border-rule bg-surface grid grid-cols-2 gap-3 rounded-sm border p-4 text-sm"
    >
      <input type="hidden" name="id" value={plan.id} />
      <label className="flex flex-col gap-1">
        Marca
        <select name="brand" defaultValue={plan.brand} className={fieldClass}>
          <option value="chelsea-st">chelsea-st</option>
          <option value="grifoai">grifoai</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Chave
        <input
          name="key"
          defaultValue={plan.key}
          required
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Nome
        <input
          name="name"
          defaultValue={plan.name}
          required
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Ordem na tela
        <input
          name="position"
          defaultValue={plan.position}
          inputMode="numeric"
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Preço mensal (R$)
        <input
          name="monthly_price"
          defaultValue={plan.monthlyPrice}
          required
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Preço anual (R$)
        <input
          name="annual_price"
          defaultValue={plan.annualPrice}
          required
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Créditos por mês
        <input
          name="monthly_credits"
          defaultValue={plan.monthlyCredits}
          inputMode="numeric"
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Minutos da trilha por dia
        <input
          name="trail_minutes_per_day"
          defaultValue={plan.trailMinutesPerDay}
          inputMode="numeric"
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Dias de teste grátis
        <input
          name="trial_days"
          defaultValue={plan.trialDays}
          inputMode="numeric"
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Créditos no teste
        <input
          name="trial_credits"
          defaultValue={plan.trialCredits}
          inputMode="numeric"
          className={fieldClass}
        />
      </label>
      <label className="col-span-2 flex flex-col gap-1">
        Teto da sobra (% dos créditos do mês que passam para o mês seguinte)
        <input
          name="carryover_percent"
          defaultValue={plan.carryoverPercent}
          inputMode="numeric"
          className={fieldClass}
        />
      </label>
      <fieldset className="col-span-2 flex flex-wrap gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="opens_voice_question"
            defaultChecked={plan.opensVoiceQuestion}
          />
          Dúvida por voz
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="opens_free_conversation"
            defaultChecked={plan.opensFreeConversation}
          />
          Conversa livre
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="opens_video"
            defaultChecked={plan.opensVideo}
          />
          Vídeo
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={plan.isActive}
          />
          À venda
        </label>
      </fieldset>
      <div className="col-span-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="bg-accent text-on-accent rounded-sm px-4 py-2 font-semibold disabled:opacity-60"
        >
          {isPending
            ? "Salvando…"
            : plan.id === ""
              ? "Criar plano"
              : "Salvar plano"}
        </button>
        {state.status === "saved" && (
          <p role="status" className="text-muted">
            {state.name} salvo.
          </p>
        )}
        {state.status === "error" && (
          <p role="alert" className="text-accent">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
