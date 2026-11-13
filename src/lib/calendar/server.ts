/**
 * The calendar invites as the server sends them (#294): the queue over the
 * functions of 0056, the Resend mailer from agenda@, the platform's origin.
 * Built on the call, so a page that never books reads no key, and the build
 * in CI runs without them.
 */

import { setTimeout as sleep } from "node:timers/promises";

import { after } from "next/server";

import { siteOfBrand } from "@/lib/brand";
import { siteConfig } from "@/lib/current-site";

import { createResendMailer } from "../mail/mailer.ts";

import { INVITE_FROM } from "./invite-mail.ts";
import { drainInvites, type DrainDeps, type DrainReport } from "./outbox.ts";
import { createSupabaseInviteQueue } from "./supabase-outbox.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "calendar/server.ts is server only and must not reach the browser",
  );
}

/** How many rows of other lessons an action also tries after its own. */
const OTHERS_PER_ACTION = 10;

/** Between two sends: under Resend's default of 2 requests a second. */
const PAUSE_MS = 600;

const NOTHING: DrainReport = { sent: 0, retry: 0, abandoned: 0 };

const log = (line: string) => console.error(line);

/** The pieces, or null with a line in the log when a key is missing. */
function calendarDeps(): DrainDeps | null {
  try {
    // The links go to the B2C brand's own site, whatever host the action or
    // the cron reached: only that brand has lessons with a teacher.
    const site = siteOfBrand("chelsea-st", siteConfig());
    if (site === null) throw new Error("the brand of the lessons has no site");
    return {
      queue: createSupabaseInviteQueue(),
      mailer: createResendMailer({
        apiKey: process.env.RESEND_API_KEY ?? "",
        from: INVITE_FROM,
      }),
      appUrl: site.origin,
      now: () => new Date(),
      log,
      pause: () => sleep(PAUSE_MS),
    };
  } catch (cause) {
    log(
      `calendar invites not sent: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return null;
  }
}

/** The daily routine's drain: any lesson, at most `limit` rows. */
export async function drainAllCalendarInvites(
  limit: number,
): Promise<DrainReport> {
  const deps = calendarDeps();
  if (deps === null) return NOTHING;
  return drainInvites(deps, { lessonId: null, limit });
}

/**
 * After the answer to a booking or a cancel: the invites of that lesson,
 * then a few left pending of others. The lesson is already written; this
 * only reads the queue and sends, and never throws.
 */
export function sendInvitesAfterResponse(lessonId: string): void {
  after(async () => {
    const deps = calendarDeps();
    if (deps === null) return;
    await drainInvites(deps, { lessonId, limit: 4 });
    await drainInvites(deps, {
      lessonId: null,
      limit: OTHERS_PER_ACTION,
      skipLessonId: lessonId,
    });
  });
}
