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
import { reconcileRefunds, type RefundReport } from "@/lib/billing/withdraw";
import { cronAuthorized } from "@/lib/cron-auth";
import { runDaily } from "@/lib/credits/daily";

/**
 * The daily routine, called by Vercel Cron (vercel.json) with Authorization:
 * Bearer CRON_SECRET, as Vercel sends it. Anyone else gets a 401 and nothing
 * runs. First the credits' step (#273), everywhere, also before billing is
 * open; then the overdue steps (Q5 of the #72 plan) and the withdrawals
 * still open (#297), only where it is.
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
  // The withdrawals still open (#297), only where billing is open: each is
  // read back from the provider. A failure is logged and kept in the report.
  let refunds: RefundReport | { skipped: string } | { error: string } = {
    skipped: "billing is not open here",
  };
  if (billingOpen()) {
    try {
      refunds = await reconcileRefunds({
        ...billingDeps(),
        now: new Date(),
        log,
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      log(`refunds daily failed: ${reason}`);
      refunds = { error: reason.slice(0, 500) };
    }
  }
  return Response.json({ ...report, refunds });
}
