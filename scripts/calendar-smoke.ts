/**
 * Sends a real calendar invite and then its cancel (#294), of a made-up
 * lesson and without the database, to the two addresses given, through
 * Resend with RESEND_API_KEY. It is what answers whether a calendar (Gmail)
 * takes the .ics attached: the event goes in with the first e-mail and out
 * with the second. Every answer is written to fixtures/calendar/smoke-<date>.jsonl
 * as it arrives, without the addresses.
 *
 *   node scripts/calendar-smoke.ts --student <e-mail> --teacher <e-mail> [--wait 60]
 *
 * Two e-mails per address, from agenda@chelsea-st.com. Resend counts them in
 * its quota; nothing else is paid. Luiz runs it: a session never sends a
 * real e-mail.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import nextEnv from "@next/env";

import {
  inviteEmail,
  INVITE_FROM,
  type DueInvite,
} from "../src/lib/calendar/invite-mail.ts";
import { createResendMailer, MailRefused } from "../src/lib/mail/mailer.ts";

function option(name: string): string | null {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : (args[at + 1] ?? null);
}

const studentEmail = option("student");
const teacherEmail = option("teacher");
const waitSeconds = Number(option("wait") ?? "60");
if (studentEmail === null || teacherEmail === null || !(waitSeconds >= 0)) {
  console.error(
    "Usage: node scripts/calendar-smoke.ts --student <e-mail> --teacher <e-mail> [--wait 60]",
  );
  process.exit(1);
}

nextEnv.loadEnvConfig(process.cwd(), true, {
  info: () => {},
  error: console.error,
});
const mailer = createResendMailer({
  apiKey: process.env.RESEND_API_KEY ?? "",
  from: INVITE_FROM,
});

const dir = join(import.meta.dirname, "..", "fixtures", "calendar");
mkdirSync(dir, { recursive: true });
const out = join(dir, `smoke-${new Date().toISOString().slice(0, 10)}.jsonl`);

function write(step: string, error: unknown = null): void {
  appendFileSync(
    out,
    `${JSON.stringify({
      at: new Date().toISOString(),
      step,
      ok: error === null,
      status: error instanceof MailRefused ? error.status : null,
      kind:
        error instanceof MailRefused
          ? error.kind
          : error === null
            ? null
            : "network",
    })}\n`,
  );
  console.log(
    error === null ? `ok   ${step}` : `FAIL ${step}: ${String(error)}`,
  );
}

// Tomorrow at the next whole hour, 50 minutes: far enough to see it in the
// calendar, and a fresh lesson id per run, so Resend's 24 h key never answers
// an earlier run.
const startsAt = new Date(
  Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 86_400_000,
);
const base: DueInvite = {
  id: "smoke",
  lessonId: `smoke-${randomUUID()}`,
  method: "request",
  recipient: "student",
  attempts: 0,
  createdAt: new Date().toISOString(),
  scheduledAt: startsAt.toISOString(),
  durationMinutes: 50,
  studentName: "Aluna Teste",
  studentEmail,
  teacherName: "Professor Teste",
  teacherEmail,
  meetUrl: "https://meet.google.com/aaa-bbbb-ccc",
  recipientTimeZone: "America/Sao_Paulo",
};
const appUrl = "https://app.chelsea-st.com";

async function send(method: "request" | "cancel"): Promise<void> {
  for (const recipient of ["student", "teacher"] as const) {
    const step = `${method} ${recipient}`;
    try {
      await mailer.send(
        inviteEmail({ ...base, method, recipient }, { appUrl }),
      );
      write(step);
    } catch (cause) {
      write(step, cause);
    }
  }
}

await send("request");
console.log(
  `Waiting ${waitSeconds} s: check that the event is in both calendars.`,
);
await sleep(waitSeconds * 1000);
await send("cancel");
console.log(`Written to ${out}. Check that the event left both calendars.`);
