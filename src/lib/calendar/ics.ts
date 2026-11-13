/**
 * The calendar invite of a booked lesson (#294), as RFC 5545 asks: a
 * VCALENDAR with one VEVENT, METHOD:REQUEST when the lesson is booked and
 * METHOD:CANCEL, with the same UID, when it is cancelled. Pure: no clock, no
 * database, no network.
 *
 * The times are UTC ("...Z") and the file carries no VTIMEZONE: every
 * calendar shows the event in the zone of whoever opens it. The organizer is
 * the platform's address, never the teacher: a "No" answered in a calendar
 * goes to that address as an e-mail and cancels nothing.
 */

import { CHELSEA } from "../brand.ts";
import { AGENDA_ADDRESS } from "../mail/senders.ts";

/** Where the invites come from and the calendar answers go to. */
export const INVITE_ADDRESS = AGENDA_ADDRESS;

export type InviteMethod = "request" | "cancel";

export type Person = {
  readonly name: string;
  readonly email: string;
};

export type LessonEvent = {
  readonly lessonId: string;
  readonly method: InviteMethod;
  readonly startsAt: Date;
  readonly durationMinutes: number;
  readonly teacherName: string;
  readonly studentName: string;
  /** The people invited: the student and the teacher, when each has an address. */
  readonly attendees: readonly Person[];
  readonly meetUrl: string | null;
  /** Where the lesson is cancelled or moved: the platform. */
  readonly platformUrl: string;
  /** When the file is written (DTSTAMP). */
  readonly stamp: Date;
};

/** One UID per lesson, the same in the request and in the cancel. */
export function lessonUid(lessonId: string): string {
  return `lesson-${lessonId}@chelsea-st.com`;
}

/** An instant as an RFC 5545 UTC date-time: 20261118T220000Z. */
export function utcStamp(instant: Date): string {
  return instant
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

/** Removes the control characters no line of the file may carry. */
function printable(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

/** A TEXT value: backslash, semicolon, comma and line break escaped. */
export function escapeText(value: string): string {
  return printable(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * A parameter value (the CN of a person), always quoted. A double quote and a
 * line break cannot appear inside one, so they are dropped.
 */
function paramValue(value: string): string {
  return `"${printable(value).replace(/["\r\n]/g, "")}"`;
}

/** An address as a mailto URI, nothing that could break the line. */
function mailto(email: string): string {
  return `mailto:${email.replace(/[\s"]/g, "")}`;
}

const encoder = new TextEncoder();

/**
 * A content line folded at 75 octets (RFC 5545, 3.1): each continuation
 * starts with one space, which counts in its 75, and a line is never cut
 * inside the bytes of one UTF-8 character.
 */
export function foldLine(line: string): string {
  const lines: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (octets + size > 75) {
      lines.push(current);
      current = " ";
      octets = 1;
    }
    current += character;
    octets += size;
  }
  lines.push(current);
  return lines.join("\r\n");
}

/** The text of the event: who, where, and that the platform cancels. */
function description(event: LessonEvent): string {
  const lines = [
    event.method === "cancel"
      ? `Esta aula de inglês de ${event.teacherName} com ${event.studentName} foi cancelada na plataforma.`
      : `Aula de inglês de ${event.teacherName} com ${event.studentName}.`,
  ];
  if (event.meetUrl !== null && event.method === "request") {
    lines.push(`Entrar na aula: ${event.meetUrl}`);
  }
  lines.push(
    `Para cancelar ou remarcar, use a plataforma: ${event.platformUrl}. Responder Não aqui não cancela a aula.`,
  );
  return lines.join("\n");
}

/** The whole file, CRLF at the end of every line. */
export function lessonIcs(event: LessonEvent): string {
  const cancel = event.method === "cancel";
  const endsAt = new Date(
    event.startsAt.getTime() + event.durationMinutes * 60_000,
  );
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//GrifoAI//${printable(CHELSEA.name)} agenda//PT`,
    "CALSCALE:GREGORIAN",
    `METHOD:${cancel ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${lessonUid(event.lessonId)}`,
    // A calendar ignores a cancel whose sequence is not above the event's.
    `SEQUENCE:${cancel ? 1 : 0}`,
    `DTSTAMP:${utcStamp(event.stamp)}`,
    `DTSTART:${utcStamp(event.startsAt)}`,
    `DTEND:${utcStamp(endsAt)}`,
    `SUMMARY:${escapeText(`Aula de inglês · ${event.teacherName} e ${event.studentName}`)}`,
    `DESCRIPTION:${escapeText(description(event))}`,
  ];
  if (event.meetUrl !== null) {
    lines.push(`LOCATION:${escapeText(event.meetUrl)}`);
    lines.push(`URL:${event.meetUrl.replace(/\s/g, "")}`);
  }
  lines.push(
    `ORGANIZER;CN=${paramValue(CHELSEA.name)}:${mailto(INVITE_ADDRESS)}`,
  );
  for (const person of event.attendees) {
    lines.push(
      `ATTENDEE;CN=${paramValue(person.name)};CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:${mailto(person.email)}`,
    );
  }
  lines.push(
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
