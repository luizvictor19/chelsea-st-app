/**
 * The browser's side of #69: an error that escapes in the tab goes to
 * /api/errors by navigator.sendBeacon, which outlives the page and never
 * waits. Light and synchronous (instrumentation-client.ts runs it before
 * hydration, and Next warns past 16 ms), and it never throws. The route is
 * sent as a pattern (no query, an id as [id], a number as [n]); the message
 * and the stack are scrubbed on the server, like everything that arrives.
 */

import { MESSAGE_LIMIT, scrubRoute } from "./scrub.ts";

export const CLIENT_ENDPOINT = "/api/errors";

/** The largest body /api/errors reads (intake.ts); this side stays under it. */
export const BODY_LIMIT = 8 * 1024;

/** Reports one page load sends at most: an error in a loop sends this many. */
export const REPORTS_PER_PAGE = 10;

/** Noise of the browser that is no failure of ours. */
const IGNORED = [/^ResizeObserver loop/];

type Beacon = (url: string, data: Blob) => boolean;

export type ClientWindow = {
  readonly location: { readonly pathname: string };
  readonly navigator: { readonly sendBeacon?: Beacon };
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: "unhandledrejection",
    listener: (event: PromiseRejectionEvent) => void,
  ): void;
};

function describe(thrown: unknown): { message: string; stack: string | null } {
  if (thrown instanceof Error) {
    const message =
      thrown.name && thrown.name !== "Error"
        ? `${thrown.name}: ${thrown.message}`
        : thrown.message;
    return { message, stack: thrown.stack ?? null };
  }
  return { message: String(thrown), stack: null };
}

/** The JSON sent, under the route's 8 KB: the stack is cut until it fits. */
export function clientPayload(thrown: unknown, pathname: string): string {
  const { message, stack } = describe(thrown);
  const base = {
    message: message.slice(0, MESSAGE_LIMIT),
    route: scrubRoute(pathname),
  };
  for (const cut of [4000, 1000, 0]) {
    const body = JSON.stringify(
      stack === null || cut === 0
        ? base
        : { ...base, stack: stack.slice(0, cut) },
    );
    if (new TextEncoder().encode(body).length <= BODY_LIMIT) return body;
  }
  return JSON.stringify({
    message: "(mensagem grande demais)",
    route: base.route,
  });
}

export function createClientReporter(
  win: ClientWindow,
): (thrown: unknown) => void {
  const seen = new Set<string>();
  let sent = 0;
  return (thrown) => {
    try {
      const body = clientPayload(thrown, win.location.pathname);
      const { message } = JSON.parse(body) as { message: string };
      if (IGNORED.some((pattern) => pattern.test(message))) return;
      if (seen.has(message) || sent >= REPORTS_PER_PAGE) return;
      const beacon = win.navigator.sendBeacon;
      if (typeof beacon !== "function") return;
      seen.add(message);
      sent += 1;
      beacon.call(
        win.navigator,
        CLIENT_ENDPOINT,
        new Blob([body], { type: "text/plain" }),
      );
    } catch {
      // A report that fails changes nothing on the page.
    }
  };
}

let shared: ((thrown: unknown) => void) | null = null;

/** Listens for what escapes: an error event, a promise nobody caught. */
export function installErrorReporting(win: ClientWindow): void {
  try {
    shared = createClientReporter(win);
    const report = shared;
    win.addEventListener("error", (event: ErrorEvent) => {
      // A script of an extension is not ours.
      if (/^(chrome|moz|safari)-extension:/.test(event.filename ?? "")) return;
      report(event.error ?? event.message);
    });
    win.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) =>
      report(event.reason),
    );
  } catch {
    // Without the listeners the page still works.
  }
}

/** The digest of a server error: the code the person can pass on. */
export function digestOf(thrown: unknown): string | null {
  if (typeof thrown !== "object" || thrown === null || !("digest" in thrown)) {
    return null;
  }
  const digest = (thrown as { digest?: unknown }).digest;
  return typeof digest === "string" && digest !== "" ? digest : null;
}

/**
 * For error.tsx and global-error.tsx: an error the boundary caught never
 * reaches the window. Only one without a digest: with one, it came from the
 * server, which recorded it already.
 */
export function reportBoundaryError(thrown: unknown): void {
  if (digestOf(thrown) !== null) return;
  if (shared === null && typeof window !== "undefined") {
    shared = createClientReporter(window);
  }
  shared?.(thrown);
}
