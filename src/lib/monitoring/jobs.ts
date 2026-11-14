/**
 * The failures the app handles and answers in silence (#69), as reports:
 * before this they reached only the Vercel runtime log, kept 1 hour. Each
 * takes the routine's own result, so the routes only hand it over.
 */

import type { WebhookResult } from "../billing/webhook.ts";
import type { DrainReport } from "../calendar/outbox.ts";
import type { DailyReport } from "../credits/daily.ts";

import type { ErrorReport } from "./report.ts";
import { describeThrown } from "./thrown.ts";

/**
 * The Asaas webhook: a 500 (Asaas delivers again), an event set aside (a
 * 200: the money event has no effect and Asaas never sends it again), or a
 * wrong token (a 401: a token changed on one side only stops every money
 * event, and Asaas pauses the queue after 15). A 401 from anyone else is one
 * row and at most one e-mail a day, like any repeat.
 */
export function webhookFailure(result: WebhookResult): ErrorReport | null {
  if (result.status === 200 && !result.note.startsWith("set aside")) {
    return null;
  }
  return {
    kind: "job",
    route: "/api/asaas/webhook",
    message: `asaas webhook ${result.status}: ${result.note}`,
  };
}

/** The webhook without its environment: every event waits at Asaas. */
export function webhookNotConfigured(cause: unknown): ErrorReport {
  return {
    kind: "job",
    route: "/api/asaas/webhook",
    message: `asaas webhook: not configured: ${describeThrown(cause).message}`,
  };
}

/** The credits' step of the daily routine, when it failed. */
export function creditsFailure(report: DailyReport): ErrorReport | null {
  if (!("error" in report.credits)) return null;
  return {
    kind: "job",
    route: "/api/billing/daily",
    message: `credits daily failed: ${report.credits.error}`,
  };
}

/** The calendar's daily routine, when an invite or a proposal was given up. */
export function calendarFailure(
  invites: DrainReport,
  proposals: DrainReport,
): ErrorReport | null {
  if (invites.abandoned === 0 && proposals.abandoned === 0) return null;
  return {
    kind: "job",
    route: "/api/calendar/daily",
    message: `calendar daily: ${invites.abandoned} invites and ${proposals.abandoned} proposal e-mails abandoned`,
  };
}

export type PlanStep = "subscribe" | "pix" | "cancel";

/**
 * A step of /dashboard/plano that could not reach the payment: the person
 * sees "Tente de novo", and the report says which step, never who.
 */
export function planFailure(step: PlanStep, cause: unknown): ErrorReport {
  const { message, stack } = describeThrown(cause);
  return {
    kind: "job",
    route: "/dashboard/plano",
    message: `plano ${step}: ${message}`,
    stack,
  };
}
