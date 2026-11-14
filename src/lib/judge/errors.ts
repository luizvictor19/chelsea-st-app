/**
 * How a judge call failed, in a shape the app can log.
 *
 * The message names the kind and the HTTP status and nothing else, because
 * the app's server log is where a message ends up, and what the person said
 * must never be there (docs/context.md, "Sensitive data and secrets"). The
 * provider's own words (the HTTP body, the model's unreadable JSON, whose
 * `heard` is what was said) go in `detail`, which only the measurement
 * script writes, into its JSONL on Luiz's machine.
 */

export const JUDGE_FAILURE_KINDS = [
  /** The provider answered with an HTTP error. */
  "http",
  /** The provider answered, but not with the forced function call. */
  "no-call",
  /** The call came back, and its arguments are not a judgement. */
  "unreadable",
  /** The call took longer than the judge's timeout. */
  "timeout",
  /** The request never got an answer: DNS, connection, TLS. */
  "network",
] as const;

export type JudgeFailureKind = (typeof JUDGE_FAILURE_KINDS)[number];

export class JudgeError extends Error {
  readonly kind: JudgeFailureKind;
  /** The HTTP status, when there was an answer. */
  readonly status: number | null;
  /** The provider's text. Never logged by the app. */
  readonly detail: string;

  constructor(
    kind: JudgeFailureKind,
    detail: string,
    status: number | null = null,
  ) {
    super(
      status === null
        ? `Judge failed: ${kind}`
        : `Judge failed: ${kind} ${status}`,
    );
    this.name = "JudgeError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

/** Whatever a fetch threw, as a JudgeError. */
export function judgeErrorFrom(cause: unknown): JudgeError {
  if (cause instanceof JudgeError) return cause;
  const name = cause instanceof Error ? cause.name : "";
  const text = cause instanceof Error ? cause.message : String(cause);
  // AbortSignal.timeout aborts with a TimeoutError; a plain abort is ours too.
  if (name === "TimeoutError" || name === "AbortError") {
    return new JudgeError("timeout", text);
  }
  return new JudgeError("network", text);
}
