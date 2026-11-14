import { timingSafeEqual } from "node:crypto";

/**
 * Whether a request comes from Vercel Cron: Authorization: Bearer
 * CRON_SECRET, as Vercel sends it, compared in constant time. A secret
 * shorter than 32 characters, or none, lets nobody in. Shared by the daily
 * routines of billing (#72) and of the calendar invites (#294).
 */
export function cronAuthorized(
  header: string | null,
  secret: string | undefined,
): boolean {
  const value = secret ?? "";
  if (value.length < 32 || header === null) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${value}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
