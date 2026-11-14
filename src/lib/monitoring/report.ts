/**
 * Reporting an error of the app (#69): scrub it, write the clean line to the
 * log, and in production record it in app_errors (0063) and e-mail Luiz when
 * the database asks. Everything is passed in, so every path is tested without
 * a server; src/lib/monitoring/server.ts wires the real pieces.
 *
 * A report never throws: a failure in here never changes the answer of the
 * request that failed.
 */

import type { Email } from "../mail/mailer.ts";

import { databaseDownEmail, errorAlertEmail } from "./alert.ts";
import { fingerprint } from "./fingerprint.ts";
import {
  scrubDigest,
  scrubMessage,
  scrubRoute,
  scrubStack,
  scrubText,
} from "./scrub.ts";
import { describeThrown, digestOf } from "./thrown.ts";

export type ErrorKind = "server" | "client" | "job";

/**
 * What a caller hands over, and nothing else: no headers, cookies, IP, user
 * agent, user, body or query. The type has no room for them, and the report
 * copies only these fields.
 */
export type ErrorReport = {
  readonly kind: ErrorKind;
  readonly route: string;
  readonly message: string;
  readonly stack?: string | null;
  readonly digest?: string | null;
};

/** An error as app_error_record takes it: scrubbed, cut, with its fingerprint. */
export type CleanError = {
  readonly fingerprint: string;
  readonly kind: ErrorKind;
  readonly route: string;
  readonly message: string;
  readonly stack: string | null;
  readonly digest: string | null;
  readonly release: string | null;
};

/** What app_error_record answers. */
export type Recorded = {
  readonly alert: boolean;
  readonly day: string;
  readonly count: number;
  readonly firstAt: string;
  readonly overflow: boolean;
};

export type ReporterDeps = {
  /** Only production records and e-mails (VERCEL_ENV); anywhere else, the log alone. */
  readonly production: boolean;
  /** The first 7 characters of the commit deployed, or null. */
  readonly release: string | null;
  readonly record: (error: CleanError) => Promise<Recorded>;
  /** ERROR_ALERT_TO, or null when it is not set. */
  readonly alertTo: string | null;
  readonly send: (email: Email) => Promise<void>;
  readonly now: () => number;
  readonly log: (line: string) => void;
};

/**
 * The database answered and refused the row (a value it cannot take): not
 * the database down, so no e-mail about it, only the log.
 */
export class RecordRefused extends Error {
  constructor(code: string) {
    super(`app_error_record refused: ${code}`);
    this.name = "RecordRefused";
  }
}

/** One e-mail about the database not answering, per instance, in this time. */
export const DATABASE_DOWN_EVERY_MS = 15 * 60 * 1000;

const KINDS: readonly ErrorKind[] = ["server", "client", "job"];

/** The 7 characters app_errors_release_shape takes, or null. */
export function releaseOf(sha: string | undefined): string | null {
  const short = (sha ?? "").slice(0, 7).toLowerCase();
  return /^[0-9a-f]{7}$/.test(short) ? short : null;
}

export function cleanError(
  report: ErrorReport,
  release: string | null,
): CleanError {
  const kind = KINDS.includes(report.kind) ? report.kind : "server";
  const route = scrubRoute(String(report.route ?? ""));
  const message = scrubMessage(String(report.message ?? ""));
  const stack = scrubStack(
    typeof report.stack === "string" ? report.stack : null,
  );
  return {
    fingerprint: fingerprint({ kind, route, message, stack }),
    kind,
    route,
    message,
    stack,
    digest: scrubDigest(report.digest),
    release,
  };
}

/**
 * Next's own throws that are not failures: redirect(), notFound() and the
 * rest of the router's signals, by their digest.
 */
const CONTROL_FLOW =
  /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/;

/**
 * What onRequestError hands over (instrumentation.ts), as a report: the
 * route's pattern and type, never request.path (it holds the query) nor
 * request.headers. Null for Next's control flow.
 */
export function serverErrorReport(
  thrown: unknown,
  context: { readonly routePath: string; readonly routeType: string },
): ErrorReport | null {
  const digest = digestOf(thrown);
  if (digest !== null && CONTROL_FLOW.test(digest)) return null;
  return {
    kind: "server",
    route: `${context.routePath} · ${context.routeType}`,
    ...describeThrown(thrown),
    digest,
  };
}

export function createReporter(
  deps: ReporterDeps,
): (report: ErrorReport) => Promise<void> {
  let lastDatabaseDown: number | null = null;

  async function databaseDown(error: CleanError, cause: unknown) {
    const reason = scrubMessage(
      cause instanceof Error ? cause.message : String(cause),
    );
    deps.log(`app error not recorded: ${reason}`);
    if (deps.alertTo === null) return;
    const now = deps.now();
    if (
      lastDatabaseDown !== null &&
      now - lastDatabaseDown < DATABASE_DOWN_EVERY_MS
    ) {
      return;
    }
    lastDatabaseDown = now;
    await deps.send(databaseDownEmail(deps.alertTo, error, reason, now));
  }

  return async function report(input) {
    try {
      const error = cleanError(input, deps.release);
      deps.log(
        `app error ${error.kind} ${error.route}: ${error.message}${
          error.digest === null ? "" : ` (digest ${error.digest})`
        }`,
      );
      if (!deps.production) return;

      let recorded: Recorded;
      try {
        recorded = await deps.record(error);
      } catch (cause) {
        if (cause instanceof RecordRefused) {
          deps.log(`app error not recorded: ${cause.message}`);
          return;
        }
        await databaseDown(error, cause);
        return;
      }
      if (!recorded.alert) return;
      if (deps.alertTo === null) {
        deps.log("app error not e-mailed: ERROR_ALERT_TO is not set");
        return;
      }
      await deps.send(errorAlertEmail(deps.alertTo, error, recorded));
    } catch (cause) {
      try {
        deps.log(
          `app error report failed: ${scrubText(String(cause)).slice(0, 300)}`,
        );
      } catch {
        // Nothing left to tell: the report never throws.
      }
    }
  };
}
