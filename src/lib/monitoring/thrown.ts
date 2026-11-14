/**
 * What a thrown value says, read the same way on the server (report.ts) and
 * in the browser (client.ts), so one error gets one message, and so one
 * fingerprint, on both sides. Pure: no node:crypto, no window.
 */

/** The message and the stack of a throw: "TypeError: x", a plain Error's message alone. */
export function describeThrown(thrown: unknown): {
  message: string;
  stack: string | null;
} {
  if (thrown instanceof Error) {
    const message =
      thrown.name && thrown.name !== "Error"
        ? `${thrown.name}: ${thrown.message}`
        : thrown.message;
    return { message, stack: thrown.stack ?? null };
  }
  return { message: String(thrown), stack: null };
}

/** Next's digest of a server error, the code the person can pass on, or null. */
export function digestOf(thrown: unknown): string | null {
  if (typeof thrown !== "object" || thrown === null || !("digest" in thrown)) {
    return null;
  }
  const digest = (thrown as { digest?: unknown }).digest;
  return typeof digest === "string" && digest !== "" ? digest : null;
}
