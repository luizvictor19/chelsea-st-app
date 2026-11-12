/**
 * The anti-robot challenge of the signup (#275, Q3): Cloudflare Turnstile.
 *
 * The widget on /cadastro puts a token in the form (cf-turnstile-response);
 * the server hands it to Cloudflare's siteverify with the secret, and only a
 * plain `success: true` lets the signup go on. Anything else refuses: no
 * secret in the environment, no token, a token too long to be one, Cloudflare
 * out of reach, an answer that is not JSON. A form that sends invite emails
 * to any address must never pass for lack of a check.
 *
 * Read from Cloudflare's docs on 2026-11-12 (developers.cloudflare.com/turnstile,
 * "Server-side validation"): POST, form encoded, secret and response, remoteip
 * optional; a token lasts 300 s and is meant for one validation; it is at
 * most 2048 characters; the answer is JSON with success and error-codes.
 * Checked against the real endpoint the same day with the docs' test secrets
 * and dummy token: the passing one passed, the failing one answered
 * invalid-input-response, the duplicate one timeout-or-duplicate. Locally
 * those test keys stand in for the real ones (.env.example).
 *
 * Pure apart from the fetch, which is passed in, so node:test runs it.
 */

export const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** The name of the field the widget adds to the form. */
export const TOKEN_FIELD = "cf-turnstile-response";

const MAX_TOKEN_LENGTH = 2048;

/** How long the server waits for Cloudflare before refusing. */
const TIMEOUT_MS = 5000;

export type ChallengeResult =
  | { readonly passed: true }
  | { readonly passed: false; readonly reason: string };

export type Fetch = (
  url: string,
  init: { method: string; body: URLSearchParams; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function verifyChallenge(input: {
  readonly secret: string | undefined;
  readonly token: unknown;
  readonly remoteIp?: string | null;
  readonly fetch: Fetch;
}): Promise<ChallengeResult> {
  const { secret, token, remoteIp, fetch } = input;
  if (!secret) {
    return { passed: false, reason: "no-secret" };
  }
  if (typeof token !== "string" || token === "") {
    return { passed: false, reason: "no-token" };
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    return { passed: false, reason: "token-too-long" };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  let answer: unknown;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return { passed: false, reason: `http-${response.status}` };
    }
    answer = await response.json();
  } catch {
    return { passed: false, reason: "unreachable" };
  }

  if (isObject(answer) && answer.success === true) {
    return { passed: true };
  }
  const codes =
    isObject(answer) && Array.isArray(answer["error-codes"])
      ? answer["error-codes"].filter((code) => typeof code === "string")
      : [];
  return {
    passed: false,
    reason: codes.length > 0 ? codes.join(",") : "not-success",
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
