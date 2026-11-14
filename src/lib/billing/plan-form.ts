/**
 * The plan form of /teacher/plans, read and checked before the database
 * does (plans, 0049, 0058): the same ranges as its checks, said in
 * Portuguese. The numbers typed here are the offer, and they live only in
 * the database (ADR 0006).
 *
 * The audience is chosen here between everyone and the founders; a personal
 * plan is born on /teacher/invites (readPersonalPlanForm) and, edited here,
 * keeps its audience and its e-mail: the form of a personal plan sends no
 * audience, and the values carry none.
 *
 * The annual price may be left empty: a plan without the annual cycle. A
 * founder or personal plan never has one (0061, #331,
 * plans_monthly_only_for_founders), and both are refused here first.
 */

import { isPlanAudience, type PlanAudience } from "../badges.ts";
import { CHELSEA } from "../brand.ts";
import { looksLikeEmail, normalizeEmail } from "../credentials.ts";

export type PlanNumbers = {
  readonly brand: "chelsea-st" | "grifoai";
  readonly key: string;
  readonly name: string;
  readonly position: number;
  readonly monthly_price_cents: number;
  /** Null: the plan has no annual cycle. */
  readonly annual_price_cents: number | null;
  readonly monthly_credits: number;
  readonly trail_minutes_per_day: number;
  readonly opens_voice_question: boolean;
  readonly opens_free_conversation: boolean;
  readonly opens_video: boolean;
  readonly trial_days: number;
  readonly trial_credits: number;
  readonly credit_ceiling_months: number;
  readonly credit_days_after_cancel: number;
  /** Null: the brand's cost of a lesson (credit_costs). */
  readonly teacher_lesson_credits: number | null;
  readonly is_active: boolean;
};

export type PlanValues = PlanNumbers & {
  /** Absent on a personal plan: its audience never changes here. */
  readonly audience?: Exclude<PlanAudience, "person">;
};

export type PlanRead =
  | { readonly ok: true; readonly values: PlanValues }
  | { readonly ok: false; readonly message: string };

export type PersonalPlanValues = PlanNumbers & {
  readonly audience: "person";
  readonly person_email: string;
};

export type PersonalPlanRead =
  | { readonly ok: true; readonly values: PersonalPlanValues }
  | { readonly ok: false; readonly message: string };

/** "57", "57,9", "1.470,00" or "1470.50" in reais, as cents; null otherwise. */
export function readReais(input: string): number | null {
  const text = input.trim().replace(/^R\$\s*/, "");
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+(,\d{1,2})?$/.test(text)) {
    normalized = text.replace(",", ".");
  } else if (/^\d+(\.\d{1,2})?$/.test(text)) {
    normalized = text;
  } else {
    return null;
  }
  const cents = Math.round(Number(normalized) * 100);
  return Number.isFinite(cents) ? cents : null;
}

function whole(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

/** Said when a founder or personal plan comes with an annual price. */
export const FOUNDER_MONTHLY_ONLY =
  "O Plano Fundador é só mensal: deixe o preço anual vazio.";
export const PERSONAL_MONTHLY_ONLY =
  "O Plano Fundador Personalizado é só mensal: deixe o preço anual vazio.";

/**
 * The plan of /teacher/plans: the numbers, and the audience unless the form
 * is a personal plan's (personal=1), which keeps its own.
 */
export function readPlanForm(form: FormData): PlanRead {
  const numbers = readPlanNumbers(form);
  if (!numbers.ok) return numbers;
  if (form.get("personal") === "1") {
    if (numbers.values.annual_price_cents !== null) {
      return { ok: false, message: PERSONAL_MONTHLY_ONLY };
    }
    return { ok: true, values: numbers.values };
  }
  const audience = form.get("audience") ?? "public";
  if (!isPlanAudience(audience) || audience === "person") {
    return { ok: false, message: "Escolha quem vê o plano." };
  }
  if (audience !== "public" && numbers.values.brand !== "chelsea-st") {
    return {
      ok: false,
      message: `O plano só para fundadores é do ${CHELSEA.name}.`,
    };
  }
  if (audience === "founder" && numbers.values.annual_price_cents !== null) {
    return { ok: false, message: FOUNDER_MONTHLY_ONLY };
  }
  return { ok: true, values: { ...numbers.values, audience } };
}

/**
 * A Plano Fundador Personalizado, written for one e-mail on
 * /teacher/invites: the numbers of any plan, always of the brand chelsea-st, and the
 * e-mail as the database keeps it (lower-cased, plans_person_email_shape).
 */
export function readPersonalPlanForm(form: FormData): PersonalPlanRead {
  // As auth and the invites keep an address (credentials.ts), which is what
  // bind_personal_plans compares.
  const email = normalizeEmail(form.get("person_email"));
  if (!looksLikeEmail(email)) {
    return { ok: false, message: "Digite um e-mail válido." };
  }
  // The brand is always chelsea-st, and the key is the caller's to make
  // (personal-<hex>): neither is typed on this form.
  const withBrand = new FormData();
  for (const [name, value] of form) withBrand.append(name, value);
  withBrand.set("brand", "chelsea-st");
  withBrand.set("key", "personal");
  const numbers = readPlanNumbers(withBrand);
  if (!numbers.ok) return numbers;
  if (numbers.values.annual_price_cents !== null) {
    return { ok: false, message: PERSONAL_MONTHLY_ONLY };
  }
  return {
    ok: true,
    values: { ...numbers.values, audience: "person", person_email: email },
  };
}

function readPlanNumbers(
  form: FormData,
):
  | { readonly ok: true; readonly values: PlanNumbers }
  | { readonly ok: false; readonly message: string } {
  const brand = form.get("brand");
  if (brand !== "chelsea-st" && brand !== "grifoai") {
    return { ok: false, message: "Escolha a marca do plano." };
  }
  const key = String(form.get("key") ?? "").trim();
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(key)) {
    return {
      ok: false,
      message:
        "A chave usa só letras minúsculas, números e hífen, e começa por letra.",
    };
  }
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 40) {
    return { ok: false, message: "O nome tem de 1 a 40 letras." };
  }
  const monthly = readReais(String(form.get("monthly_price") ?? ""));
  if (monthly === null || monthly <= 0) {
    return {
      ok: false,
      message: "O preço mensal precisa ser um valor em reais maior que zero.",
    };
  }
  // Empty is a plan without the annual cycle (0061).
  const annualText = String(form.get("annual_price") ?? "").trim();
  const annual = annualText === "" ? null : readReais(annualText);
  if (annualText !== "" && (annual === null || annual <= 0)) {
    return {
      ok: false,
      message:
        "O preço anual fica vazio (sem cobrança anual) ou é um valor em reais maior que zero.",
    };
  }
  const position = whole(form.get("position")) ?? 0;
  const credits = whole(form.get("monthly_credits"));
  const minutes = whole(form.get("trail_minutes_per_day"));
  const trialDays = whole(form.get("trial_days"));
  const trialCredits = whole(form.get("trial_credits"));
  if (credits === null || trialCredits === null) {
    return {
      ok: false,
      message: "Os créditos são números inteiros, zero ou mais.",
    };
  }
  // 0 is a plan without the trail (0058).
  if (minutes === null || minutes > 240) {
    return {
      ok: false,
      message: "Os minutos da trilha por dia vão de 0 (sem trilha) a 240.",
    };
  }
  if (trialDays === null || trialDays > 60) {
    return { ok: false, message: "Os dias de teste vão de 0 a 60." };
  }
  const ceiling = whole(form.get("credit_ceiling_months"));
  if (ceiling === null || ceiling < 1 || ceiling > 60) {
    return {
      ok: false,
      message: "O teto do saldo vai de 1 a 60 meses de créditos do plano.",
    };
  }
  const daysAfterCancel = whole(form.get("credit_days_after_cancel"));
  if (daysAfterCancel === null || daysAfterCancel > 365) {
    return {
      ok: false,
      message: "Os dias dos créditos depois do cancelamento vão de 0 a 365.",
    };
  }
  const lessonText = String(form.get("teacher_lesson_credits") ?? "").trim();
  const lesson = lessonText === "" ? null : whole(lessonText);
  if (lessonText !== "" && (lesson === null || lesson < 1)) {
    return {
      ok: false,
      message:
        "O custo da aula é um número inteiro maior que zero, ou vazio para o custo da marca.",
    };
  }
  return {
    ok: true,
    values: {
      brand,
      key,
      name,
      position,
      monthly_price_cents: monthly,
      annual_price_cents: annual,
      monthly_credits: credits,
      trail_minutes_per_day: minutes,
      opens_voice_question: form.get("opens_voice_question") === "on",
      opens_free_conversation: form.get("opens_free_conversation") === "on",
      opens_video: form.get("opens_video") === "on",
      trial_days: trialDays,
      trial_credits: trialCredits,
      credit_ceiling_months: ceiling,
      credit_days_after_cancel: daysAfterCancel,
      teacher_lesson_credits: lesson,
      is_active: form.get("is_active") === "on",
    },
  };
}
