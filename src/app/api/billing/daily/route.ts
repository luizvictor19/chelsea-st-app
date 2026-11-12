import { timingSafeEqual } from "node:crypto";

import { billingDay } from "@/lib/billing/dates";
import { siteOfBrand } from "@/lib/brand";
import { siteConfig } from "@/lib/current-site";
import { runOverdue } from "@/lib/billing/overdue";
import {
  billingDeps,
  billingMailer,
  billingOpen,
  emailOf,
} from "@/lib/billing/server";

/**
 * The daily overdue routine (Q5 of the #72 plan), called by Vercel Cron
 * (vercel.json) with Authorization: Bearer CRON_SECRET, as Vercel sends it.
 * Anyone else gets a 401 and nothing runs.
 */
function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 32 || header === null) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request.headers.get("authorization"))) {
    return new Response(null, { status: 401 });
  }
  if (!billingOpen()) {
    return Response.json({ skipped: "billing is not open here" });
  }
  const deps = billingDeps();
  const report = await runOverdue({
    provider: deps.provider,
    store: deps.store,
    mailer: billingMailer(),
    today: billingDay(new Date()),
    emailOf,
    // The links in the e-mails go to the B2C brand's own site, not to whatever
    // host the cron reached.
    appUrl:
      siteOfBrand("chelsea-st", siteConfig())?.origin ??
      new URL(request.url).origin,
    log: (line) => console.error(line),
  });
  return Response.json(report);
}
