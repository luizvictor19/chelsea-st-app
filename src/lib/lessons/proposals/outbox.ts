/**
 * Sending the e-mails of lesson proposals (#319). The rows are written by the
 * database in the transaction that proposes (lesson_proposal_mails, 0057);
 * this reads them, sends each e-mail and marks the row, after the commit and
 * out of it: nothing here ever touches a proposal, and nothing here throws.
 * The shape of the calendar invites' outbox (#294), with its attempts and its
 * codes; a second small queue rather than one general one (the plan's
 * decision).
 *
 * The log never carries an address or a name: the proposal, the side and a
 * code.
 */

import { failureCode, MAX_ATTEMPTS } from "../../calendar/outbox.ts";
import type { Mailer } from "../../mail/mailer.ts";

import { proposalEmail, type DueProposalMail } from "./proposal-mail.ts";

export interface ProposalMailQueue {
  /** Pending rows not tried lately, oldest first, of one proposal or (null) of any. */
  due(
    proposalId: string | null,
    limit: number,
  ): Promise<readonly DueProposalMail[]>;
  sent(id: string): Promise<void>;
  failed(
    id: string,
    code: string,
    giveUp: boolean,
    tried: boolean,
  ): Promise<void>;
}

export type ProposalDrainDeps = {
  readonly queue: ProposalMailQueue;
  readonly mailer: Mailer;
  /** The platform's origin, for the link. */
  readonly appUrl: string;
  readonly log: (line: string) => void;
  /** Waits between two sends, under the provider's rate per second. */
  readonly pause: () => Promise<void>;
};

export type ProposalDrainReport = {
  readonly sent: number;
  readonly retry: number;
  readonly abandoned: number;
};

function label(mail: DueProposalMail): string {
  return `proposal mail ${mail.proposalId} ${mail.recipient}`;
}

function storeFailure(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).slice(0, 120);
}

async function record(
  deps: ProposalDrainDeps,
  mail: DueProposalMail,
  code: string,
  giveUp: boolean,
  tried: boolean,
): Promise<void> {
  deps.log(`${label(mail)}: ${code}${giveUp ? ", abandoned" : ""}`);
  try {
    await deps.queue.failed(mail.id, code, giveUp, tried);
  } catch (cause) {
    deps.log(`${label(mail)}: not recorded: ${storeFailure(cause)}`);
  }
}

/**
 * Sends the pending rows of one proposal (right after the action) or of any
 * (the daily routine), at most `limit`. Each row is sent, or recorded as
 * failed with its code, or abandoned when it cannot go.
 */
export async function drainProposalMails(
  deps: ProposalDrainDeps,
  scope: { readonly proposalId: string | null; readonly limit: number },
): Promise<ProposalDrainReport> {
  let mails: readonly DueProposalMail[];
  try {
    mails = await deps.queue.due(scope.proposalId, scope.limit);
  } catch (cause) {
    deps.log(`proposal mails not read: ${storeFailure(cause)}`);
    return { sent: 0, retry: 0, abandoned: 0 };
  }

  let sent = 0;
  let retry = 0;
  let abandoned = 0;
  let sends = 0;
  for (const mail of mails) {
    if (mail.recipientEmail === null) {
      await record(deps, mail, "no_address", true, false);
      abandoned++;
      continue;
    }
    if (sends > 0) await deps.pause();
    sends++;
    try {
      await deps.mailer.send(proposalEmail(mail, { appUrl: deps.appUrl }));
    } catch (cause) {
      const giveUp = mail.attempts + 1 >= MAX_ATTEMPTS;
      await record(deps, mail, failureCode(cause), giveUp, true);
      if (giveUp) abandoned++;
      else retry++;
      continue;
    }
    sent++;
    try {
      await deps.queue.sent(mail.id);
    } catch (cause) {
      // The e-mail went; the next run sends it under the same idempotency
      // key, which Resend answers without a second e-mail.
      deps.log(`${label(mail)}: sent, not marked: ${storeFailure(cause)}`);
    }
  }
  return { sent, retry, abandoned };
}
