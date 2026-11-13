/**
 * The daily routine of the calendar invites (#294), called by Vercel Cron
 * (vercel.json) with Authorization: Bearer CRON_SECRET: it sends what the
 * actions left pending, of any lesson. Anyone else gets a 401 and nothing is
 * read or sent. Apart from the billing routine, which stays closed while
 * there is no Asaas key: an invite cannot wait for that.
 */

import { cronAuthorized } from "../cron-auth.ts";

import type { DrainReport } from "./outbox.ts";

/**
 * How many rows one run sends at most: above a day of bookings, and, paced
 * under the provider's rate, inside the route's maxDuration. What is left
 * waits for the next action or the next day.
 */
export const DAILY_LIMIT = 50;

export async function calendarDaily(
  request: Request,
  deps: {
    readonly secret: string | undefined;
    readonly drain: (limit: number) => Promise<DrainReport>;
  },
): Promise<Response> {
  if (!cronAuthorized(request.headers.get("authorization"), deps.secret)) {
    return new Response(null, { status: 401 });
  }
  return Response.json(await deps.drain(DAILY_LIMIT));
}
