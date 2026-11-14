/**
 * What /api/errors accepts from a browser (#69). The route is open, so it
 * trusts nothing: an Origin that is not one of the brand's sites, a body
 * above 8 KB, a body that is not a JSON object of message, stack and route
 * alone, are all dropped without a word (the route answers 204 to every
 * call, so a refusal tells nothing). What passes is scrubbed later, by the
 * report, like any other error.
 */

import { resolveSite, type SiteConfig } from "../brand.ts";

import { BODY_LIMIT } from "./client.ts";
import type { ErrorReport } from "./report.ts";

export { BODY_LIMIT };

const FIELDS = new Set(["message", "stack", "route"]);

/** The Origin is a listed site's own, whole: scheme, host and port. */
export function originAllowed(
  origin: string | null,
  config: SiteConfig,
): boolean {
  if (origin === null) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return resolveSite(host, config)?.origin === origin;
}

/** The body, or null past the limit, read without taking more than it. */
async function boundedText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > BODY_LIMIT) return null;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readClientReport(
  request: Request,
  allowed: (origin: string | null) => boolean,
): Promise<ErrorReport | null> {
  if (!allowed(request.headers.get("origin"))) return null;
  const text = await boundedText(request).catch(() => null);
  if (text === null) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !FIELDS.has(key))) return null;
  const { message, stack, route } = record;
  if (typeof message !== "string" || message.trim() === "") return null;
  if (stack !== undefined && stack !== null && typeof stack !== "string") {
    return null;
  }
  if (route !== undefined && typeof route !== "string") return null;
  return {
    kind: "client",
    route: route ?? "/",
    message,
    stack: stack ?? null,
  };
}
