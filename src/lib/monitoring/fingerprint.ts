/**
 * Which errors are the same error (#69): the sha256 of the kind, the route,
 * the scrubbed message without its digits (a count or a status changes, the
 * error does not) and the first frame of the stack without its line and
 * column (an edit elsewhere in the file moves them). One row a day per
 * fingerprint in app_errors (0063), so one e-mail a day per error at most.
 */

import { createHash } from "node:crypto";

/** The first line of a stack that is a frame, in Chrome's or Firefox's shape. */
export function firstFrame(stack: string | null): string {
  if (stack === null) return "";
  const frame = stack
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("at ") || /^[^\s:]*@\S/.test(line));
  return (frame ?? "").replace(/:\d+:\d+(?=\)?$)/, "");
}

export function fingerprint(error: {
  readonly kind: string;
  readonly route: string;
  readonly message: string;
  readonly stack: string | null;
}): string {
  return createHash("sha256")
    .update(
      [
        error.kind,
        error.route,
        error.message.replace(/\d+/g, ""),
        firstFrame(error.stack),
      ].join("\n"),
    )
    .digest("hex");
}
