/**
 * The calendar invites as the server sends them (#294): the queue over the
 * functions of 0056, the Resend mailer from agenda@, the platform's origin.
 * Built on the call, so a page that never books reads no key, and the build
 * in CI runs without them.
 */

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

const log = (line: string) => console.error(line);

function calendarDeps(): DrainDeps {
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
  };
}

/** One drain, never throwing: a missing key is logged and the rows wait. */
export async function drainCalendarInvites(scope: {
  readonly lessonId: string | null;
  readonly limit: number;
  readonly skipLessonId?: string;
}): Promise<DrainReport> {
  let deps: DrainDeps;
  try {
    deps = calendarDeps();
  } catch (cause) {
    log(
      `calendar invites not sent: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return { sent: 0, retry: 0, abandoned: 0 };
  }
  return drainInvites(deps, scope);
}

/**
 * After the answer to a booking or a cancel: the invites of that lesson,
 * then a few left pending of any other. The lesson is already written; this
 * only reads the queue and sends.
 */
export function sendInvitesAfterResponse(lessonId: string): void {
  after(async () => {
    await drainCalendarInvites({ lessonId, limit: 4 });
    await drainCalendarInvites({
      lessonId: null,
      limit: OTHERS_PER_ACTION,
      skipLessonId: lessonId,
    });
  });
}
