/**
 * The e-mail that carries a lesson's invite (#294): one per person, because
 * the text says the time in the zone of whoever reads it; the .ics attached
 * is the same for both. Portuguese, as every string a person reads.
 */

import { CHELSEA } from "../brand.ts";
import { formatLessonDate, formatLessonTime } from "../datetime.ts";
import type { Email } from "../mail/mailer.ts";

import {
  INVITE_ADDRESS,
  lessonIcs,
  type InviteMethod,
  type Person,
} from "./ics.ts";

export type Recipient = "student" | "teacher";

/** A row of the queue to send, as calendar_invites_due (0056) gives it. */
export type DueInvite = {
  readonly id: string;
  readonly lessonId: string;
  readonly method: InviteMethod;
  readonly recipient: Recipient;
  readonly attempts: number;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly studentName: string;
  readonly studentEmail: string | null;
  readonly teacherName: string;
  /** The teacher's calendar e-mail (teachers.calendar_email), not her login. */
  readonly teacherEmail: string | null;
  readonly meetUrl: string | null;
  /** The zone of the person this row goes to (profiles.timezone). */
  readonly recipientTimeZone: string;
};

/** The sender, on the brand's domain. */
export const INVITE_FROM = `${CHELSEA.name} <${INVITE_ADDRESS}>`;

const FALLBACK_ZONE = "America/Sao_Paulo";

/** The zone when the runtime knows it; São Paulo when its tzdata dropped it. */
function knownZone(zone: string): string {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: zone });
    return zone;
  } catch {
    return FALLBACK_ZONE;
  }
}

/** The address of the person this row goes to, or null when there is none. */
export function recipientEmail(invite: DueInvite): string | null {
  return invite.recipient === "student"
    ? invite.studentEmail
    : invite.teacherEmail;
}

/**
 * One key per lesson, kind and person: two senders of the same row (the
 * action and the daily routine) send one e-mail.
 */
export function idempotencyKey(invite: DueInvite): string {
  return `lesson-${invite.lessonId}-${invite.method}-${invite.recipient}`;
}

/** Her first name, for the greeting. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * The e-mail of one row. The platform's link is the recipient's own screen
 * in the text, and the platform's address in the .ics, which is the same for
 * both.
 */
export function inviteEmail(
  invite: DueInvite,
  options: { readonly appUrl: string; readonly now: Date },
): Email {
  const to = recipientEmail(invite);
  if (to === null) throw new Error("the invite has no address to go to");
  const zone = knownZone(invite.recipientTimeZone);
  const startsAt = new Date(invite.scheduledAt);
  const day = formatLessonDate(startsAt, zone);
  const time = formatLessonTime(startsAt, zone);
  const student = invite.recipient === "student";
  const name = student ? invite.studentName : invite.teacherName;
  const other = student ? invite.teacherName : invite.studentName;
  const link = `${options.appUrl}${student ? "/dashboard/lessons" : "/teacher/agenda"}`;
  const cancel = invite.method === "cancel";

  const attendees: Person[] = [];
  if (invite.studentEmail !== null) {
    attendees.push({ name: invite.studentName, email: invite.studentEmail });
  }
  if (invite.teacherEmail !== null) {
    attendees.push({ name: invite.teacherName, email: invite.teacherEmail });
  }
  const ics = lessonIcs({
    lessonId: invite.lessonId,
    method: invite.method,
    startsAt,
    durationMinutes: invite.durationMinutes,
    teacherName: invite.teacherName,
    studentName: invite.studentName,
    attendees,
    meetUrl: invite.meetUrl,
    platformUrl: options.appUrl,
    stamp: options.now,
  });

  const when = `${day}, às ${time} (fuso ${zone})`;
  const lines = cancel
    ? [
        `Olá, ${firstName(name)}.`,
        "",
        `A aula de inglês com ${other} de ${when} foi cancelada na plataforma.`,
        "",
        "O convite anexo tira a aula da sua agenda.",
        `Para marcar outra, use a plataforma: ${link}`,
      ]
    : [
        `Olá, ${firstName(name)}.`,
        "",
        `A sua aula de inglês com ${other} está marcada para ${when}.`,
        ...(invite.meetUrl === null
          ? []
          : ["", `Entrar na aula: ${invite.meetUrl}`]),
        "",
        "O convite anexo põe a aula na sua agenda.",
        `Para cancelar ou remarcar, use a plataforma: ${link}`,
        'Responder "Não" no convite da agenda não cancela a aula.',
      ];

  return {
    to,
    subject: `${cancel ? "Aula cancelada" : "Aula marcada"} · ${day}, ${time}`,
    text: lines.join("\n"),
    replyTo: INVITE_ADDRESS,
    attachments: [
      {
        filename: "invite.ics",
        content: Buffer.from(ics, "utf8").toString("base64"),
        contentType: `text/calendar; charset=utf-8; method=${cancel ? "CANCEL" : "REQUEST"}`,
      },
    ],
    idempotencyKey: idempotencyKey(invite),
  };
}
