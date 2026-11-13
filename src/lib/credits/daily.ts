/**
 * The daily routine (/api/billing/daily): the credits' step first, then the
 * overdue steps of #72. The credits' step runs everywhere, also where
 * billing is not open (production before the Asaas key): closing a lot past
 * its end needs no provider. A failure of the
 * credits is logged and kept in the report, and the overdue steps still run:
 * the two do not depend on each other, and the next day's run repeats the
 * credits' step safely (credit_daily is idempotent).
 */

import type { OverdueReport } from "../billing/overdue.ts";
import type { CreditDailyReport } from "../billing/store.ts";

export type DailyReport = {
  readonly credits: CreditDailyReport | { readonly error: string };
  readonly overdue: OverdueReport | { readonly skipped: string };
};

export type DailyDeps = {
  /** credit_daily, through the store. Built inside, so a missing key is caught. */
  readonly credits: () => Promise<CreditDailyReport>;
  /** The overdue routine, or null where billing is not open. */
  readonly overdue: (() => Promise<OverdueReport>) | null;
  readonly log: (line: string) => void;
};

export async function runDaily(deps: DailyDeps): Promise<DailyReport> {
  let credits: DailyReport["credits"];
  try {
    credits = await deps.credits();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    deps.log(`credits daily failed: ${reason}`);
    credits = { error: reason.slice(0, 500) };
  }
  const overdue =
    deps.overdue === null
      ? { skipped: "billing is not open here" }
      : await deps.overdue();
  return { credits, overdue };
}
