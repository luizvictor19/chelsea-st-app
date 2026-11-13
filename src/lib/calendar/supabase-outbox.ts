/**
 * The InviteQueue over the three calendar functions of 0056, called with the
 * service role. Server only: the client holds the key that passes every
 * policy, and this file names no table, only calendar_* functions.
 */

import { createServiceClient } from "../billing/supabase-store.ts";

import type { DueInvite } from "./invite-mail.ts";
import type { InviteQueue } from "./outbox.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "calendar/supabase-outbox.ts is server only and must not reach the browser",
  );
}

export function createSupabaseInviteQueue(
  client = createServiceClient(),
): InviteQueue {
  return {
    async due(lessonId, limit) {
      // The generated Args type p_lesson as a string; the function takes
      // null for "any lesson" (the generator cannot read that a parameter
      // may be null), so the record goes through as it is.
      const args = { p_lesson: lessonId, p_limit: limit } as never;
      const { data, error } = await client.rpc("calendar_invites_due", args);
      if (error) {
        throw new Error(`calendar_invites_due failed: ${error.code}`);
      }
      return data.map((row): DueInvite => ({
        id: row.id,
        lessonId: row.lesson_id,
        method: row.method === "cancel" ? "cancel" : "request",
        recipient: row.recipient === "teacher" ? "teacher" : "student",
        attempts: row.attempts,
        scheduledAt: row.scheduled_at,
        durationMinutes: row.duration_minutes,
        studentName: row.student_name,
        // The generator marks every column of a returned table as not
        // null; these three are null when there is no address or Meet.
        studentEmail: (row.student_email as string | null) ?? null,
        teacherName: row.teacher_name,
        teacherEmail: (row.teacher_email as string | null) ?? null,
        meetUrl: (row.meet_url as string | null) ?? null,
        recipientTimeZone: row.recipient_timezone,
      }));
    },

    async sent(id) {
      const { error } = await client.rpc("calendar_invite_sent", { p_id: id });
      if (error) throw new Error(`calendar_invite_sent failed: ${error.code}`);
    },

    async failed(id, code, giveUp) {
      const { error } = await client.rpc("calendar_invite_failed", {
        p_id: id,
        p_error: code,
        p_give_up: giveUp,
      });
      if (error) {
        throw new Error(`calendar_invite_failed failed: ${error.code}`);
      }
    },
  };
}
