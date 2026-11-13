/**
 * The ProposalMailQueue over the three functions of 0057 that only
 * service_role executes. Server only: the client holds the key that passes
 * every policy, and this file names no table, only lesson_proposal_mail*
 * functions.
 */

import { createServiceClient } from "../../supabase/service.ts";

import type { ProposalMailQueue } from "./outbox.ts";
import type { DueProposalMail } from "./proposal-mail.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "lessons/proposals/supabase-outbox.ts is server only and must not reach the browser",
  );
}

export function createSupabaseProposalMailQueue(
  client = createServiceClient(),
): ProposalMailQueue {
  return {
    async due(proposalId, limit) {
      // p_proposal left out is null in the function: any proposal.
      const { data, error } = await client.rpc(
        "lesson_proposal_mails_due",
        proposalId === null
          ? { p_limit: limit }
          : { p_limit: limit, p_proposal: proposalId },
      );
      if (error) {
        throw new Error(`lesson_proposal_mails_due failed: ${error.code}`);
      }
      return data.map((row): DueProposalMail => ({
        id: row.id,
        proposalId: row.proposal_id,
        recipient: row.recipient === "teacher" ? "teacher" : "student",
        attempts: row.attempts,
        // The generator marks every column of a returned table as not
        // null; the address is null when there is none.
        recipientEmail: (row.recipient_email as string | null) ?? null,
        recipientName: row.recipient_name,
        recipientTimeZone: row.recipient_timezone,
        proposerName: row.proposer_name,
        startsAt: row.starts_at,
        durationMinutes: row.duration_minutes,
        expiresAt: row.expires_at,
      }));
    },

    async sent(id) {
      const { error } = await client.rpc("lesson_proposal_mail_sent", {
        p_id: id,
      });
      if (error) {
        throw new Error(`lesson_proposal_mail_sent failed: ${error.code}`);
      }
    },

    async failed(id, code, giveUp, tried) {
      const { error } = await client.rpc("lesson_proposal_mail_failed", {
        p_id: id,
        p_error: code,
        p_give_up: giveUp,
        p_tried: tried,
      });
      if (error) {
        throw new Error(`lesson_proposal_mail_failed failed: ${error.code}`);
      }
    },
  };
}
