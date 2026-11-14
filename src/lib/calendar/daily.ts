/**
 * The daily routine of the calendar invites (#294) and of the e-mails of
 * lesson proposals (#319), called by Vercel Cron (vercel.json) with
 * Authorization: Bearer CRON_SECRET: it sends what the actions left pending,
 * of any lesson and any proposal. Anyone else gets a 401 and nothing is read
 * or sent. Apart from the billing routine, which stays closed while there is
 * no Asaas key: an invite cannot wait for that. A row given up (abandoned)
 * also reaches the error log (#69): the teacher sees it on her agenda, Luiz
 * did not.
 */

import { cronAuthorized } from "../cron-auth.ts";
import { calendarFailure } from "../monitoring/jobs.ts";
import type { ErrorReport } from "../monitoring/report.ts";

import type { DrainReport } from "./outbox.ts";

/**
 * How many rows one run sends at most: above a day of bookings, and, paced
 * under the provider's rate, inside the route's maxDuration. What is left
 * waits for the next action or the next day.
 */
export const DAILY_LIMIT = 50;

/** The proposal e-mails one run sends at most, after the invites. */
export const DAILY_PROPOSAL_LIMIT = 10;

export async function calendarDaily(
  request: Request,
  deps: {
    readonly secret: string | undefined;
    readonly drain: (limit: number) => Promise<DrainReport>;
    readonly drainProposals: (limit: number) => Promise<DrainReport>;
    readonly report: (error: ErrorReport) => Promise<void>;
  },
): Promise<Response> {
  if (!cronAuthorized(request.headers.get("authorization"), deps.secret)) {
    return new Response(null, { status: 401 });
  }
  const invites = await deps.drain(DAILY_LIMIT);
  const proposals = await deps.drainProposals(DAILY_PROPOSAL_LIMIT);
  const failure = calendarFailure(invites, proposals);
  if (failure !== null) await deps.report(failure);
  return Response.json({ ...invites, proposals });
}
