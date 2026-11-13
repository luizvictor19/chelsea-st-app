import { calendarDaily } from "@/lib/calendar/daily";
import { drainCalendarInvites } from "@/lib/calendar/server";

/**
 * The daily routine of the calendar invites (#294), called by Vercel Cron
 * (vercel.json) with Authorization: Bearer CRON_SECRET; anyone else gets a
 * 401 and nothing runs.
 */
export async function GET(request: Request): Promise<Response> {
  return calendarDaily(request, {
    secret: process.env.CRON_SECRET,
    drain: (limit) => drainCalendarInvites({ lessonId: null, limit }),
  });
}
