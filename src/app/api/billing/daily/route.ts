import { timingSafeEqual } from "node:crypto";

import { billingDay } from "@/lib/billing/dates";
import { siteOfBrand } from "@/lib/brand";
import { siteConfig } from "@/lib/current-site";
import { runOverdue } from "@/lib/billing/overdue";
import {
  billingDeps,
  billingMailer,
  billingOpen,
  billingStore,
  emailOf,
} from "@/lib/billing/server";
import { runDaily } from "@/lib/credits/daily";

/**
 * The daily routine, called by Vercel Cron (vercel.json) with Authorization:
 * Bearer CRON_SECRET, as Vercel sends it. Anyone else gets a 401 and nothing
 * runs. First the credits' step (#273), everywhere, also before billing is
 * open; then the overdue steps (Q5 of the #72 plan), only where it is.
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
  const log = (line: string) => console.error(line);
  const report = await runDaily({
    credits: () => billingStore().creditDaily(),
    overdue: billingOpen()
      ? () => {
          const deps = billingDeps();
          return runOverdue({
            provider: deps.provider,
            store: deps.store,
            mailer: billingMailer(),
            today: billingDay(new Date()),
            emailOf,
            // The links in the e-mails go to the B2C brand's own site, not to
            // whatever host the cron reached.
            appUrl:
              siteOfBrand("chelsea-st", siteConfig())?.origin ??
              new URL(request.url).origin,
            log,
          });
        }
      : null,
    log,
  });
  return Response.json(report);
}
