/**
 * What a founder is shown and charged on a Plano Fundador (#292, 0058): once
 * her terms are fixed on her seal (her first paid founder subscription), the
 * plan's prices, credits of a month and cost of a lesson are hers, whatever
 * the plan says today. The database copies the same terms onto her new
 * subscription and refuses another value; this is the screen's side of it.
 * The terms are monthly only (0062, #331): a founder plan has no annual
 * price, and the seal keeps none.
 *
 * Pure: no database.
 */

export type SealTerms = {
  readonly termsFixedAt: string | null;
  readonly monthlyPriceCents: number | null;
  readonly monthlyCredits: number | null;
  readonly teacherLessonCredits: number | null;
};

export type ShownPlan = {
  readonly audience: string;
  readonly monthlyPriceCents: number;
  /** Null: no annual cycle, as on every founder plan. */
  readonly annualPriceCents: number | null;
  readonly monthlyCredits: number;
  readonly teacherLessonCredits: number | null;
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
    seal.monthlyCredits === null
  ) {
    return plan;
  }
  return {
    ...plan,
    monthlyPriceCents: seal.monthlyPriceCents,
    monthlyCredits: seal.monthlyCredits,
    teacherLessonCredits: seal.teacherLessonCredits,
  };
}
