/**
 * Sending what the queue holds (#294). The rows are written by the database
 * in the transaction that books or cancels (calendar_invites, 0056); this
 * reads them, sends each e-mail and marks the row, after the commit and out
 * of it: nothing here ever touches a lesson, and nothing here throws.
 *
 * The queue and the mailer come in as parameters, so a test runs it with
 * fakes. The log never carries an address or a name: the lesson, the kind,
 * the person's role and a code.
 */

import { MailRefused, type Mailer } from "../mail/mailer.ts";

import { inviteEmail, recipientEmail, type DueInvite } from "./invite-mail.ts";

/**
 * Attempts before a row is abandoned and the teacher sees "convite não
 * enviado" on her agenda: with the daily routine, about five days, and less
 * when bookings and cancels go on meanwhile.
 */
export const MAX_ATTEMPTS = 5;

export interface InviteQueue {
  /** Pending rows, oldest first, of one lesson or (null) of any. */
  due(lessonId: string | null, limit: number): Promise<readonly DueInvite[]>;
  sent(id: string): Promise<void>;
  /** One attempt more with its code; abandoned when giveUp. */
  failed(id: string, code: string, giveUp: boolean): Promise<void>;
}

export type DrainDeps = {
  readonly queue: InviteQueue;
  readonly mailer: Mailer;
  /** The platform's origin, for the links. */
  readonly appUrl: string;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

export type DrainReport = {
  readonly sent: number;
  readonly retry: number;
  readonly abandoned: number;
};

/** A code for the failure that names no person: Resend's status and kind. */
export function failureCode(cause: unknown): string {
  if (cause instanceof MailRefused) {
    return `resend_${cause.status}_${cause.kind}`;
  }
  if (
    cause instanceof Error &&
    (cause.name === "TimeoutError" || cause.name === "AbortError")
  ) {
    return "timeout";
  }
  return "send_error";
}

/** Why a row is given up before any send, or null when it may go. */
function notSendable(invite: DueInvite, now: Date): string | null {
  if (recipientEmail(invite) === null) return "no_address";
  const start = Date.parse(invite.scheduledAt);
  // A request after the start puts a past event in a calendar; a cancel
  // still takes one out until the lesson's planned end.
  if (invite.method === "request" && now.getTime() >= start) {
    return "lesson_started";
  }
  if (
    invite.method === "cancel" &&
    now.getTime() >= start + invite.durationMinutes * 60_000
  ) {
    return "lesson_ended";
  }
  return null;
}

function label(invite: DueInvite): string {
  return `calendar invite ${invite.lessonId} ${invite.method} ${invite.recipient}`;
}

/**
 * Sends the pending rows of one lesson (right after the action) or of any
 * (the daily routine), at most `limit`. Each row is sent, or recorded as
 * failed with its code, or abandoned when it cannot go any more.
 */
export async function drainInvites(
  deps: DrainDeps,
  scope: {
    readonly lessonId: string | null;
    readonly limit: number;
    /** A lesson whose rows were just tried: not tried twice in one go. */
    readonly skipLessonId?: string;
  },
): Promise<DrainReport> {
  let sent = 0;
  let retry = 0;
  let abandoned = 0;

  let invites: readonly DueInvite[];
  try {
    invites = await deps.queue.due(scope.lessonId, scope.limit);
  } catch (cause) {
    deps.log(`calendar invites not read: ${storeFailure(cause)}`);
    return { sent, retry, abandoned };
  }

  for (const invite of invites) {
    if (invite.lessonId === scope.skipLessonId) continue;
    const now = deps.now();
    const reason = notSendable(invite, now);
    if (reason !== null) {
      await record(deps, invite, reason, true);
      abandoned++;
      continue;
    }
    try {
      await deps.mailer.send(inviteEmail(invite, { appUrl: deps.appUrl, now }));
    } catch (cause) {
      const giveUp = invite.attempts + 1 >= MAX_ATTEMPTS;
      await record(deps, invite, failureCode(cause), giveUp);
      if (giveUp) abandoned++;
      else retry++;
      continue;
    }
    sent++;
    try {
      await deps.queue.sent(invite.id);
    } catch (cause) {
      // The e-mail went; the next run sends it again under the same
      // idempotency key, which Resend answers without a second e-mail.
      deps.log(`${label(invite)}: sent, not marked: ${storeFailure(cause)}`);
    }
  }
  return { sent, retry, abandoned };
}

async function record(
  deps: DrainDeps,
  invite: DueInvite,
  code: string,
  giveUp: boolean,
): Promise<void> {
  deps.log(`${label(invite)}: ${code}${giveUp ? ", abandoned" : ""}`);
  try {
    await deps.queue.failed(invite.id, code, giveUp);
  } catch (cause) {
    deps.log(`${label(invite)}: not recorded: ${storeFailure(cause)}`);
  }
}

/**
 * The queue's own failure, for the log: the database's message names a
 * function or a constraint, never a person; cut short all the same.
 */
function storeFailure(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).slice(0, 120);
}
