/**
 * reportError as the server runs it (#69): the reporter of report.ts over
 * app_error_record and the Resend mailer from alertas@. Built on the first
 * call, so a page that never fails reads no key, and the build in CI runs
 * without them. Only Vercel's production records and e-mails; a preview has
 * no service role (docs/context.md), and local and CI only log.
 */

import { CHELSEA } from "@/lib/brand";

import { createResendMailer, type Email } from "../mail/mailer.ts";
import { ALERTS_ADDRESS } from "../mail/senders.ts";

import { createReporter, releaseOf, type ErrorReport } from "./report.ts";
import { recordAppError } from "./store.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "monitoring/server.ts is server only and must not reach the browser",
  );
}

const FROM = `${CHELSEA.name} <${ALERTS_ADDRESS}>`;

let reporter: ((report: ErrorReport) => Promise<void>) | null = null;

function send(email: Email): Promise<void> {
  // Throws on a missing key: the reporter catches it and logs it.
  return createResendMailer({
    apiKey: process.env.RESEND_API_KEY ?? "",
    from: FROM,
  }).send(email);
}

/**
 * Reports one error and never throws. Await it where the work must finish
 * before the answer (onRequestError); hand it to after() where the answer
 * should not wait.
 */
export function reportError(report: ErrorReport): Promise<void> {
  reporter ??= createReporter({
    production: process.env.VERCEL_ENV === "production",
    release: releaseOf(process.env.VERCEL_GIT_COMMIT_SHA),
    record: recordAppError,
    alertTo: process.env.ERROR_ALERT_TO?.trim() || null,
    send,
    now: () => Date.now(),
    log: (line) => console.error(line),
  });
  return reporter(report);
}
