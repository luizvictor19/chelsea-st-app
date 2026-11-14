/**
 * Her credits as the plan screen shows them: the balance, and how many of
 * them end first and on which day. Read from credit_live_lots (0050), one
 * row per live lot with what is left and when it ends: never while her
 * subscription is alive (a month's lot), at the trial's end, or some days
 * after a cancel.
 */

import { billingDay } from "../billing/dates.ts";

export type LiveLot = {
  readonly remaining: number;
  /** When the lot stops counting (midnight in São Paulo), or null: never. */
  readonly expiresAt: string | null;
};

export type CreditSummary = {
  readonly balance: number;
  /** The credits that end first, and the last day they can be used. */
  readonly next: { readonly credits: number; readonly lastDay: string } | null;
  /** How many have no end while her subscription is alive. */
  readonly lasting: number;
};

/** The last day a lot can be used: the day before the midnight it expires. */
export function lastDayOf(expiresAt: string): string {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) throw new Error(`Not a timestamp: ${expiresAt}`);
  return billingDay(new Date(at - 1));
}

export function summarize(lots: readonly LiveLot[]): CreditSummary {
  const left = lots.filter((lot) => lot.remaining > 0);
  const balance = left.reduce((sum, lot) => sum + lot.remaining, 0);
  const lasting = left
    .filter((lot) => lot.expiresAt === null)
    .reduce((sum, lot) => sum + lot.remaining, 0);
  const ending = left.flatMap((lot) =>
    lot.expiresAt === null
      ? []
      : [{ remaining: lot.remaining, day: lastDayOf(lot.expiresAt) }],
  );
  if (ending.length === 0) return { balance, next: null, lasting };
  const lastDay = ending.map((lot) => lot.day).sort()[0];
  const credits = ending
    .filter((lot) => lot.day === lastDay)
    .reduce((sum, lot) => sum + lot.remaining, 0);
  return { balance, next: { credits, lastDay }, lasting };
}

/** "1 crédito", "3 créditos". */
export function creditsText(credits: number): string {
  return `${credits} ${credits === 1 ? "crédito" : "créditos"}`;
}
