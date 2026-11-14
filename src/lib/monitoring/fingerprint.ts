/**
 * Which errors are the same error (#69): the sha256 of the kind, the route,
 * the scrubbed message without its digits (a count or a status changes, the
 * error does not) and the function of the first frame of the stack (its file
 * and line change with every build). One row a day per
 * fingerprint in app_errors (0063), so one e-mail a day per error at most.
 */

import { createHash } from "node:crypto";

/**
 * The function of the first frame of a stack, in Chrome's shape (at f (...))
 * or Firefox's (f@...): never its file, whose name carries a hash of the
 * build that changes with every deploy, nor its line and column. An
 * anonymous frame gives "", and the message and the route decide.
 */
export function firstFrame(stack: string | null): string {
  if (stack === null) return "";
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    const chrome = /^at (?:async )?([^\s(]+) \(/.exec(line);
    if (chrome) return chrome[1];
    if (line.startsWith("at ")) return "";
    const firefox = /^([^\s@]*)@\S/.exec(line);
    if (firefox) return firefox[1];
  }
  return "";
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
