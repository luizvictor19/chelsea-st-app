"use client";

import { useActionState, useState } from "react";

import { subscribe, type SubscribeState } from "./actions";
import { formatCents } from "./format";
import type { PlanOnSale } from "./queries";

const INITIAL: SubscribeState = { status: "idle" };

const fieldClass =
  "border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 outline-none";

/**
 * Plan, cycle, how to pay, name and CPF. The card is typed on the provider's
 * page, never here (Q1): this form only says which one.
 */
export function SubscribeForm({
  plans,
  chosenPlanId = null,
  trialDays,
  defaultName,
}: {
  readonly plans: readonly PlanOnSale[];
  /** The plan the link asked for (?plano=), checked instead of the first. */
  readonly chosenPlanId?: string | null;
  readonly trialDays: number | null;
  readonly defaultName: string;
}) {
  const [state, formAction, isPending] = useActionState(subscribe, INITIAL);
  const [billingType, setBillingType] = useState<"card" | "pix">("card");

  return (
    <form
      action={formAction}
      className="border-rule bg-surface flex flex-col gap-5 rounded-sm border p-6"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">Plano</legend>
        {plans.map((plan, index) => (
          <label key={plan.id} className="flex items-start gap-3">
            <input
              type="radio"
              name="plan"
              value={plan.id}
              defaultChecked={
                chosenPlanId === null ? index === 0 : plan.id === chosenPlanId
              }
              required
              className="mt-1"
            />
            <span>
              <span className="font-semibold">{plan.name}</span>
              <span className="text-muted block text-sm">
                {formatCents(plan.monthlyPriceCents)} por mês ou{" "}
                {formatCents(plan.annualPriceCents)} por ano ·{" "}
                {plan.monthlyCredits} créditos por mês
                {plan.teacherLessonCredits !== null &&
                  ` · Aula com professor: ${plan.teacherLessonCredits} ${plan.teacherLessonCredits === 1 ? "crédito" : "créditos"}`}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">Cobrança</legend>
        <label className="flex items-center gap-3">
          <input type="radio" name="cycle" value="monthly" defaultChecked />
          Mensal
        </label>
        <label className="flex items-center gap-3">
          <input type="radio" name="cycle" value="annual" />
          Anual
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-semibold">Forma de pagamento</legend>
        <label className="flex items-center gap-3">
          <input
            type="radio"
            name="billingType"
            value="card"
            checked={billingType === "card"}
            onChange={() => setBillingType("card")}
          />
          Cartão de crédito
        </label>
        <label className="flex items-center gap-3">
          <input
            type="radio"
            name="billingType"
            value="pix"
            checked={billingType === "pix"}
            onChange={() => setBillingType("pix")}
          />
          Pix
        </label>
      </fieldset>

      <label className="flex flex-col gap-2">
        <span className="font-semibold">Nome completo</span>
        <input
          name="name"
          defaultValue={defaultName}
          required
          autoComplete="name"
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-semibold">CPF</span>
        <input
          name="cpf"
          required
          inputMode="numeric"
          autoComplete="off"
          placeholder="000.000.000-00"
          className={fieldClass}
        />
      </label>

      <p className="text-muted text-sm">
        {trialDays !== null
          ? `Os primeiros ${trialDays} dias são grátis. A primeira cobrança é no ${trialDays + 1}º dia; cancele antes e não paga nada.`
          : "A primeira cobrança é hoje."}{" "}
        {billingType === "card"
          ? "O cartão é digitado na página segura do pagamento."
          : "O Pix aparece aqui depois de assinar."}
      </p>

      {state.status === "error" && (
        <p role="alert" className="text-accent text-sm">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="bg-accent text-on-accent rounded-sm px-5 py-3 font-semibold disabled:opacity-60"
      >
        {isPending ? "Enviando…" : "Assinar"}
      </button>
    </form>
  );
}
