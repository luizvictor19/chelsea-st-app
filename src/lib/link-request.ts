/**
 * The answer of the screens that send a link by email: the magic link
 * (/login), "Esqueci minha senha" (/forgot-password), #110, and the signup
 * (/cadastro), #275.
 *
 * Whatever depends on the account must not reach the screen. GoTrue refuses an
 * address without an account in 1 to 8 ms and spends 1539 to 1630 ms sending
 * the email of one that has it (Auth logs, 25/10 to 07/11); and every error it
 * returns after finding the account (the limit per address, the limit per
 * hour, a failed SMTP) only exists for an address that has one. So the screen
 * says "sent" for every valid address, at once, and the send runs after the
 * response, through `after` in the actions. What went wrong goes to the
 * server log only, without the address.
 *
 * Kept apart from the actions so node:test can run it: it takes the send, the
 * schedule and the log from outside, for the reason src/lib/auth-links.ts
 * gives (node:test loads neither next/server nor Supabase).
 */

import { looksLikeEmail } from "./credentials.ts";

export type LinkFlow = "magic_link" | "recovery" | "signup";

/** GoTrue's error, as supabase-js returns it, or null when the call went through. */
export type SendOutcome = {
  readonly code?: string;
  readonly status?: number;
  readonly message?: string;
} | null;

export type LinkTask = () => Promise<void>;

export type LinkLog = {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
};

export type LinkRequestState =
  { status: "sent"; email: string } | { status: "error"; message: string };

export type LinkRequest = {
  /** Already normalized (src/lib/credentials.ts). */
  readonly email: string;
  readonly flow: LinkFlow;
  readonly send: () => Promise<SendOutcome>;
  readonly schedule: (task: LinkTask) => void;
  readonly log: LinkLog;
};

/**
 * Asking twice within GoTrue's 60 s per address: normal use, a warning.
 * GoTrue gives the same code, over_email_send_rate_limit, to the project's
 * cap of emails per hour, which stops every send and is an error; only the
 * message tells them apart ("For security purposes, you can only request this
 * after N seconds." against "email rate limit exceeded", read from GoTrue's
 * internal/api/errors.go, not measured). Anything else reads as the cap.
 */
const PER_ADDRESS_LIMIT = /only request this after \d+ seconds?/i;

function isPerAddressLimit(outcome: NonNullable<SendOutcome>): boolean {
  return (
    outcome.code === "over_email_send_rate_limit" &&
    PER_ADDRESS_LIMIT.test(outcome.message ?? "")
  );
}

export function requestLink(request: LinkRequest): LinkRequestState {
  const { email, flow, send, schedule, log } = request;

  // Checked before any call and independent of the account.
  if (!looksLikeEmail(email)) {
    return { status: "error", message: "Digite um e-mail válido." };
  }

  schedule(async () => {
    let outcome: SendOutcome;
    try {
      outcome = await send();
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      log.error("link request failed", {
        flow,
        code: "exception",
        message: withoutAddress(message, email),
      });
      return;
    }
    // null is a send that went through, or nothing to send (the caller
    // turns "no account" into null: src/lib/magic-link.ts).
    if (outcome === null) {
      return;
    }
    const entry = {
      flow,
      code: outcome.code ?? "-",
      status: outcome.status ?? "-",
      message: withoutAddress(outcome.message ?? "-", email),
    };
    if (isPerAddressLimit(outcome)) {
      log.warn("link request rate limited", entry);
    } else {
      log.error("link request failed", entry);
    }
  });

  return { status: "sent", email };
}

/** The message with the address taken out, whatever its case, plain or URL-encoded. */
function withoutAddress(message: string, email: string): string {
  let result = message;
  for (const form of new Set([email, encodeURIComponent(email)])) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), "<email>");
  }
  return result;
}
