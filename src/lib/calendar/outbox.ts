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
 * enviado" on her agenda. calendar_invites_due holds a row 30 minutes after
 * each attempt, so five attempts take at least two hours, and with the daily
 * routine alone about five days.
 */
export const MAX_ATTEMPTS = 5;

export interface InviteQueue {
  /** Pending rows not tried lately, oldest first, of one lesson or (null) of any. */
  due(lessonId: string | null, limit: number): Promise<readonly DueInvite[]>;
  /**
   * Marks the row sent; true when that reopened a cancel of its lesson (the
   * request went after the lesson was cancelled).
   */
  sent(id: string): Promise<boolean>;
  /**
   * Its code, one attempt more when the e-mail was handed to the provider
   * (tried), and abandoned when giveUp.
   */
  failed(
    id: string,
    code: string,
    giveUp: boolean,
    tried: boolean,
  ): Promise<void>;
}

export type DrainDeps = {
  readonly queue: InviteQueue;
  readonly mailer: Mailer;
  /** The platform's origin, for the links. */
  readonly appUrl: string;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  /** Waits between two sends, under the provider's rate per second. */
  readonly pause: () => Promise<void>;
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

type Tally = { sent: number; retry: number; abandoned: number; sends: number };

/**
 * Sends the pending rows of one lesson (right after the action) or of any
 * (the daily routine), at most `limit`. Each row is sent, or recorded as
 * failed with its code, or abandoned when it cannot go any more. A cancel a
 * late request reopened goes in the same call.
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
  const tally: Tally = { sent: 0, retry: 0, abandoned: 0, sends: 0 };
  const reopened = await pass(deps, scope, tally);
  for (const lessonId of reopened) {
    await pass(deps, { lessonId, limit: 4 }, tally);
  }
  return { sent: tally.sent, retry: tally.retry, abandoned: tally.abandoned };
}

/** One read of the queue and its rows; the lessons whose cancel reopened. */
async function pass(
  deps: DrainDeps,
  scope: {
    readonly lessonId: string | null;
    readonly limit: number;
    readonly skipLessonId?: string;
  },
  tally: Tally,
): Promise<Set<string>> {
  const reopened = new Set<string>();
  let invites: readonly DueInvite[];
  try {
    invites = await deps.queue.due(scope.lessonId, scope.limit);
  } catch (cause) {
    deps.log(`calendar invites not read: ${storeFailure(cause)}`);
    return reopened;
  }

  for (const invite of invites) {
    if (invite.lessonId === scope.skipLessonId) continue;
    const reason = notSendable(invite, deps.now());
    if (reason !== null) {
      await record(deps, invite, reason, true, false);
      tally.abandoned++;
      continue;
    }
    if (tally.sends > 0) await deps.pause();
    tally.sends++;
    try {
      await deps.mailer.send(inviteEmail(invite, { appUrl: deps.appUrl }));
    } catch (cause) {
      const giveUp = invite.attempts + 1 >= MAX_ATTEMPTS;
      await record(deps, invite, failureCode(cause), giveUp, true);
      if (giveUp) tally.abandoned++;
      else tally.retry++;
      continue;
    }
    tally.sent++;
    try {
      if (await deps.queue.sent(invite.id)) reopened.add(invite.lessonId);
    } catch (cause) {
      // The e-mail went; the next run sends the same bytes under the same
      // idempotency key, which Resend answers without a second e-mail.
      deps.log(`${label(invite)}: sent, not marked: ${storeFailure(cause)}`);
    }
  }
  return reopened;
}

async function record(
  deps: DrainDeps,
  invite: DueInvite,
  code: string,
  giveUp: boolean,
  tried: boolean,
): Promise<void> {
  deps.log(`${label(invite)}: ${code}${giveUp ? ", abandoned" : ""}`);
  try {
    await deps.queue.failed(invite.id, code, giveUp, tried);
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
