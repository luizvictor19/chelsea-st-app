import { calendarDaily } from "@/lib/calendar/daily";
import { drainAllCalendarInvites } from "@/lib/calendar/server";

/**
 * The daily routine of the calendar invites (#294), called by Vercel Cron
 * (vercel.json) with Authorization: Bearer CRON_SECRET; anyone else gets a
 * 401 and nothing runs. DAILY_LIMIT rows, paced, fit in this time.
 */
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return calendarDaily(request, {
    secret: process.env.CRON_SECRET,
    drain: drainAllCalendarInvites,
  });
}
