import { magicLinkOptions } from "./auth-links.ts";
import type { Site } from "./brand.ts";
import { looksLikeEmail } from "./credentials.ts";
import {
  requestLink,
  type LinkLog,
  type LinkRequestState,
  type LinkTask,
  type SendOutcome,
} from "./link-request.ts";
import { magicLinkStep } from "./magic-link.ts";
import type { ChallengeResult } from "./turnstile.ts";

/*
 * The signup of the chelsea-st brand (#275): an invite the person asks for herself.
 *
 * The server calls inviteUserByEmail with the service role and the metadata
 * { signup: true, full_name }; GoTrue's own signup stays off (#109), so the
 * public key creates no account from any host. The metadata only says "came
 * from the signup": the database picks the organization, the one with
 * open_signup, on the first confirmation (0051).
 *
 * What GoTrue does with each kind of address, measured on the local stack on
 * 2026-11-12 (step 0 of the plan): a new one gets the account, unconfirmed,
 * with the metadata, and the email; a confirmed account is refused with
 * email_exists and gets nothing, so the server sends the magic link instead;
 * an unconfirmed one (an invite not yet accepted, a signup without a click)
 * gets the email again, with the metadata it already had. The screen knows
 * none of this: it answers like the link screens (src/lib/link-request.ts).
 *
 * Pure on purpose, for node:test: the actions pass the calls in.
 */

/** Longer than any name; a name is cut here, never refused. */
export const MAX_NAME_LENGTH = 120;

/** Trimmed, every run of spaces made one, cut to MAX_NAME_LENGTH. */
export function signupName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}

/** Whether /cadastro exists on this site, and whether it takes people. */
export type SignupDoor = "absent" | "closed" | "open";

/**
 * Only the chelsea-st site has the page: a company on GrifoAI is invite only, and a
 * host outside the list (a preview) is nobody's. It is closed until the
 * subscription opens (a person who cannot subscribe has nothing to do) and
 * while either Turnstile key is missing (the challenge would refuse every
 * try).
 */
export function signupDoor(
  site: Site | null,
  open: {
    readonly billing: boolean;
    readonly siteKey: string | undefined;
    readonly secretKey: string | undefined;
  },
): SignupDoor {
  if (site?.brand.key !== "chelsea-st") {
    return "absent";
  }
  return open.billing && open.siteKey && open.secretKey ? "open" : "closed";
}

/**
 * Options of inviteUserByEmail for the signup. The link leads back to the
 * chelsea-st site the person asked from, the dev server's own origin
 * included: unlike an invite (inviteOptions), the person who asked is the
 * one who opens the email. Any other site sends no redirect, so the Site
 * URL, which is Chelsea's.
 */
export function signupOptions(
  site: Site | null,
  name: string,
): {
  data: { signup: true; full_name: string };
  redirectTo?: string;
} {
  const data = { signup: true as const, full_name: name };
  return site?.brand.key === "chelsea-st"
    ? { data, redirectTo: site.origin }
    : { data };
}

/** GoTrue's error, as supabase-js returns it. */
type AuthError = {
  readonly code?: string;
  readonly status?: number;
  readonly message?: string;
} | null;

export type SignupCalls = {
  readonly invite: (
    email: string,
    options: ReturnType<typeof signupOptions>,
  ) => Promise<{ error: AuthError }>;
  readonly magicLink: (
    email: string,
    options: ReturnType<typeof magicLinkOptions>,
  ) => Promise<{ error: AuthError }>;
};

/**
 * The send of a signup, run after the answer. An address that already has a
 * confirmed account gets the link to sign in, as the screen promises.
 * Whatever else goes wrong is returned for requestLink to log.
 */
export async function signupSend(
  email: string,
  name: string,
  site: Site | null,
  calls: SignupCalls,
): Promise<SendOutcome> {
  const { error } = await calls.invite(email, signupOptions(site, name));
  if (error === null) {
    return null;
  }
  if (error.code !== "email_exists") {
    return error;
  }
  const { error: linkError } = await calls.magicLink(
    email,
    magicLinkOptions(site),
  );
  return magicLinkStep(linkError) === "sent" ? null : linkError;
}

export type SignupRequest = {
  readonly name: string;
  /** Already normalized (src/lib/credentials.ts). */
  readonly email: string;
  /** Checked only once the name and the address are well formed. */
  readonly challenge: () => Promise<ChallengeResult>;
  readonly send: () => Promise<SendOutcome>;
  readonly schedule: (task: LinkTask) => void;
  readonly log: LinkLog;
};

/**
 * The answer of /cadastro. The name, the address and the challenge do not
 * depend on the account, so each can refuse on the screen; past them the
 * answer is requestLink's, "sent" for every address, before the send.
 *
 * The challenge comes last: its token is good once, so a typo in the address
 * does not spend it.
 */
export async function requestSignup(
  request: SignupRequest,
): Promise<LinkRequestState> {
  const { name, email, challenge, send, schedule, log } = request;

  if (name === "") {
    return { status: "error", message: "Digite o seu nome." };
  }
  if (!looksLikeEmail(email)) {
    return { status: "error", message: "Digite um e-mail válido." };
  }

  const result = await challenge();
  if (!result.passed) {
    log.warn("signup challenge refused", { reason: result.reason });
    return {
      status: "error",
      message:
        "Não conseguimos confirmar que você não é um robô. Tente de novo.",
    };
  }

  return requestLink({ email, flow: "signup", send, schedule, log });
}
