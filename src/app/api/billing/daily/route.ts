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
import { cronAuthorized } from "@/lib/cron-auth";
import { runDaily } from "@/lib/credits/daily";
import { creditsFailure } from "@/lib/monitoring/jobs";
import { reportError } from "@/lib/monitoring/server";

/**
 * The daily routine, called by Vercel Cron (vercel.json) with Authorization:
 * Bearer CRON_SECRET, as Vercel sends it. Anyone else gets a 401 and nothing
 * runs. First the credits' step (#273), everywhere, also before billing is
 * open; then the overdue steps (Q5 of the #72 plan), only where it is. A
 * failure of the credits also reaches the error log (#69): the report it
 * answers with is read by nobody.
 */
export async function GET(request: Request): Promise<Response> {
  if (
    !cronAuthorized(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
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
  const failure = creditsFailure(report);
  if (failure !== null) await reportError(failure);
  return Response.json(report);
}
