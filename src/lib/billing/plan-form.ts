/**
 * The plan form of /teacher/plans, read and checked before the database
 * does (plans, 0049): the same ranges as its checks, said in Portuguese. The
 * numbers typed here are the offer, and they live only in the database
 * (ADR 0006).
 */

export type PlanValues = {
  readonly brand: "chelsea-st" | "grifoai";
  readonly key: string;
  readonly name: string;
  readonly position: number;
  readonly monthly_price_cents: number;
  readonly annual_price_cents: number;
  readonly monthly_credits: number;
  readonly trail_minutes_per_day: number;
  readonly opens_voice_question: boolean;
  readonly opens_free_conversation: boolean;
  readonly opens_video: boolean;
  readonly trial_days: number;
  readonly trial_credits: number;
  readonly credit_ceiling_months: number;
  readonly credit_days_after_cancel: number;
  readonly is_active: boolean;
};

export type PlanRead =
  | { readonly ok: true; readonly values: PlanValues }
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

export function readPlanForm(form: FormData): PlanRead {
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
  const annual = readReais(String(form.get("annual_price") ?? ""));
  if (monthly === null || monthly <= 0 || annual === null || annual <= 0) {
    return {
      ok: false,
      message: "Os dois preços precisam ser valores em reais maiores que zero.",
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
  if (minutes === null || minutes < 1 || minutes > 240) {
    return {
      ok: false,
      message: "Os minutos da trilha por dia vão de 1 a 240.",
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
      is_active: form.get("is_active") === "on",
    },
  };
}
