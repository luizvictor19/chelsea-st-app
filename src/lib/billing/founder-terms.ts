/**
 * What a founder is shown and charged on a Plano Fundador (#292, 0058): once
 * her terms are fixed on her seal (her first paid founder subscription), the
 * plan's prices, credits of a month and cost of a lesson are hers, whatever
 * the plan says today. The database copies the same terms onto her new
 * subscription and refuses another value; this is the screen's side of it.
 *
 * Pure: no database.
 */

export type SealTerms = {
  readonly termsFixedAt: string | null;
  readonly monthlyPriceCents: number | null;
  readonly annualPriceCents: number | null;
  readonly monthlyCredits: number | null;
  readonly teacherLessonCredits: number | null;
};

export type ShownPlan = {
  readonly audience: string;
  readonly monthlyPriceCents: number;
  readonly annualPriceCents: number;
  readonly monthlyCredits: number;
  readonly teacherLessonCredits: number | null;
  readonly terms?: {
    readonly monthlyPriceCents: number;
    readonly annualPriceCents: number;
  } | null;
};

export function withFounderTerms<P extends ShownPlan>(
  plan: P,
  seal: SealTerms | null,
): P {
  if (
    plan.audience !== "founder" ||
    seal === null ||
    seal.termsFixedAt === null ||
    seal.monthlyPriceCents === null ||
    seal.annualPriceCents === null ||
    seal.monthlyCredits === null
  ) {
    return plan;
  }
  const terms = {
    monthlyPriceCents: seal.monthlyPriceCents,
    annualPriceCents: seal.annualPriceCents,
  };
  return {
    ...plan,
    ...terms,
    monthlyCredits: seal.monthlyCredits,
    teacherLessonCredits: seal.teacherLessonCredits,
    terms,
  };
}
