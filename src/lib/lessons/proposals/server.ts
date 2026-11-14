/**
 * The e-mails of lesson proposals as the server sends them (#319): the queue
 * over the functions of 0057, the Resend mailer from agenda@, the
 * platform's origin. Built on the call, so a page that never proposes reads
 * no key, and the build in CI runs without them.
 */

import { setTimeout as sleep } from "node:timers/promises";

import { after } from "next/server";

import { siteOfBrand } from "@/lib/brand";
import { INVITE_FROM } from "@/lib/calendar/invite-mail";
import { siteConfig } from "@/lib/current-site";
import { createResendMailer } from "@/lib/mail/mailer";

import {
  drainProposalMails,
  type ProposalDrainDeps,
  type ProposalDrainReport,
} from "./outbox.ts";
import { createSupabaseProposalMailQueue } from "./supabase-outbox.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "lessons/proposals/server.ts is server only and must not reach the browser",
  );
}

/** How many e-mails of other proposals an action also tries after its own. */
const OTHERS_PER_ACTION = 5;

/** Between two sends: under Resend's default of 2 requests a second. */
const PAUSE_MS = 600;

const NOTHING: ProposalDrainReport = { sent: 0, retry: 0, abandoned: 0 };

const log = (line: string) => console.error(line);

/** The pieces, or null with a line in the log when a key is missing. */
function proposalDeps(): ProposalDrainDeps | null {
  try {
    // The link goes to the B2C brand's own site: only that brand has
    // lessons with a teacher.
    const site = siteOfBrand("chelsea-st", siteConfig());
    if (site === null) throw new Error("the brand of the lessons has no site");
    return {
      queue: createSupabaseProposalMailQueue(),
      mailer: createResendMailer({
        apiKey: process.env.RESEND_API_KEY ?? "",
        from: INVITE_FROM,
      }),
      appUrl: site.origin,
      log,
      pause: () => sleep(PAUSE_MS),
    };
  } catch (cause) {
    log(
      `proposal mails not sent: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return null;
  }
}

/** The daily routine's drain: any proposal, at most `limit` rows. */
export async function drainAllProposalMails(
  limit: number,
): Promise<ProposalDrainReport> {
  const deps = proposalDeps();
  if (deps === null) return NOTHING;
  return drainProposalMails(deps, { proposalId: null, limit });
}

/**
 * After the answer to a proposal: its e-mail, then a few left pending of
 * others. The proposal is already written; this only reads the queue and
 * sends, and never throws.
 */
export function sendProposalMailAfterResponse(proposalId: string): void {
  after(async () => {
    const deps = proposalDeps();
    if (deps === null) return;
    await drainProposalMails(deps, { proposalId, limit: 1 });
    await drainProposalMails(deps, {
      proposalId: null,
      limit: OTHERS_PER_ACTION,
    });
  });
}
