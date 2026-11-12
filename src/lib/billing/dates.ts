/**
 * Calendar days in São Paulo, where the provider counts due days and where
 * the trial's first day is the day of the subscription. Pure, so the edges
 * (midnight, the end of a month, a leap day) can be shown.
 */

import type { Cycle } from "./provider.ts";

export const BILLING_TIME_ZONE = "America/Sao_Paulo";

/** The day `at` falls on in São Paulo, "YYYY-MM-DD". */
export function billingDay(at: Date): string {
  // en-CA writes the date as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BILLING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function parse(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Not a day: ${day}`);
  return new Date(`${day}T00:00:00Z`);
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const date = parse(day);
  date.setUTCDate(date.getUTCDate() + days);
  return format(date);
}

/** Whole days from `from` to `to`; negative when `to` comes first. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

/**
 * The first charge: the day of the subscription is the first day of the
 * trial, so a trial of 14 days charges on day 15, the subscription day plus
 * 14 (note of 06/11 on #72). With no trial, the day itself.
 */
export function firstDueOn(today: string, trialDays: number): string {
  if (!Number.isInteger(trialDays) || trialDays < 0) {
    throw new Error(`Trial days must be a whole number, got ${trialDays}`);
  }
  return addDays(today, trialDays);
}

/**
 * The same day one cycle later, held to the last day of a shorter month:
 * 31/01 is followed by 28/02 (29/02 in a leap year), 29/02 by 28/02.
 */
export function addCycle(day: string, cycle: Cycle): string {
  const date = parse(day);
  const months = cycle === "monthly" ? 1 : 12;
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return format(target);
}

/** The last day a charge due on `dueOn` pays for. */
export function paidThroughOf(dueOn: string, cycle: Cycle): string {
  return addDays(addCycle(dueOn, cycle), -1);
}
