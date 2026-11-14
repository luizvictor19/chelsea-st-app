"use client";

import { useActionState } from "react";

import {
  invitePersonalPlan,
  type PersonalPlanState,
} from "./personal-plan-actions";

const INITIAL: PersonalPlanState = { status: "idle" };

const fieldClass =
  "border-rule bg-surface focus:border-accent rounded-sm border px-3 py-2 outline-none";

/**
 * A Plano Fundador Personalizado for one e-mail: the numbers of any plan and
 * the address. The person gets an e-mail from agenda@; when she enters with
 * that address, the front door takes her to its checkout. Its numbers are
 * changed later on /teacher/plans, never its person.
 */
export function PersonalPlanForm() {
  const [state, formAction, isPending] = useActionState(
    invitePersonalPlan,
    INITIAL,
  );

  return (
    <form
      action={formAction}
      className="border-rule bg-surface grid grid-cols-2 gap-3 rounded-sm border p-6 text-sm"
    >
      <label className="col-span-2 flex flex-col gap-1">
        <span className="font-semibold">E-mail da pessoa</span>
        <input
          name="person_email"
          type="email"
          autoComplete="off"
          required
          placeholder="pessoa@exemplo.com"
          className={fieldClass}
        />
      </label>
      <p className="text-muted col-span-2">
        Confira o e-mail antes de criar: o plano vai para a conta que confirmar
        este endereço, e depois de ligado não muda de pessoa.
      </p>
      <label className="flex flex-col gap-1">
        Nome do plano
        <input name="name" required className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1">
        Custo da aula em créditos (vazio = o custo da marca)
        <input
          name="teacher_lesson_credits"
          inputMode="numeric"
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Preço mensal (R$)
        <input name="monthly_price" required className={fieldClass} />
      </label>
      <p className="text-muted flex flex-col justify-end gap-1">
        Só mensal: o Personalizado não tem cobrança anual.
      </p>
      <label className="flex flex-col gap-1">
        Créditos por mês
        <input
          name="monthly_credits"
          inputMode="numeric"
          required
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Minutos da trilha por dia (0 = sem trilha)
        <input
          name="trail_minutes_per_day"
          defaultValue={0}
          inputMode="numeric"
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Teto do saldo (meses de créditos do plano)
        <input
          name="credit_ceiling_months"
          inputMode="numeric"
          required
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        Dias dos créditos depois do cancelamento
        <input
          name="credit_days_after_cancel"
          inputMode="numeric"
          required
          className={fieldClass}
        />
      </label>
      <input type="hidden" name="trial_days" value="0" />
      <input type="hidden" name="trial_credits" value="0" />
      <input type="hidden" name="is_active" value="on" />
      <fieldset className="col-span-2 flex flex-wrap gap-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="opens_voice_question" />
          Dúvida por voz
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="opens_free_conversation" />
          Conversa livre
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="opens_video" />
          Vídeo
        </label>
      </fieldset>

      {state.status === "error" && (
        <p role="alert" className="text-accent col-span-2">
          {state.message}
        </p>
      )}
      {state.status === "unsent" && (
        <p role="alert" className="text-accent col-span-2">
          {state.message}
        </p>
      )}
      {state.status === "sent" && (
        <p role="status" className="text-muted col-span-2">
          Plano criado e e-mail enviado para{" "}
          <span className="font-mono">{state.email}</span>.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="bg-accent text-accent-foreground col-span-2 self-start justify-self-start rounded-sm px-5 py-3 font-semibold disabled:opacity-60"
      >
        {isPending ? "Criando..." : "Criar plano e enviar"}
      </button>
    </form>
  );
}
