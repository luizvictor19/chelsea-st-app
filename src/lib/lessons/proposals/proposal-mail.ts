/**
 * The e-mail that tells the other side of a lesson proposal (#319): to the
 * student, a teacher's proposal; to the teacher's calendar e-mail, a
 * student's. From agenda@, as the calendar invites (#294), with the dates in
 * the zone of whoever reads it and the link to her own screen, where she
 * answers. Portuguese, as every string a person reads.
 */

import { formatLessonDate, formatLessonTime } from "../../datetime.ts";
import type { Email } from "../../mail/mailer.ts";
import { INVITE_ADDRESS } from "../../calendar/ics.ts";

export type ProposalSide = "student" | "teacher";

/** A row of the queue to send, as lesson_proposal_mails_due (0057) gives it. */
export type DueProposalMail = {
  readonly id: string;
  readonly proposalId: string;
  /** Who the e-mail goes to: the side that did not propose. */
  readonly recipient: ProposalSide;
  readonly attempts: number;
  /** The student's account e-mail, or the teacher's calendar e-mail. */
  readonly recipientEmail: string | null;
  readonly recipientName: string;
  readonly recipientTimeZone: string;
  readonly proposerName: string;
  readonly startsAt: readonly string[];
  readonly durationMinutes: number;
  /** When the proposal stops being open. */
  readonly expiresAt: string;
};

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

/** Her first name, for the greeting. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * One key per proposal and person: two senders of the same row (the action
 * and the daily routine) send one e-mail.
 */
export function proposalIdempotencyKey(mail: DueProposalMail): string {
  return `proposal-${mail.proposalId}-${mail.recipient}`;
}

/** The screen where the recipient answers. */
export function answerPath(recipient: ProposalSide): string {
  return recipient === "student" ? "/dashboard" : "/teacher/agenda";
}

/** The e-mail of one row; a row without an address is never sent. */
export function proposalEmail(
  mail: DueProposalMail,
  options: { readonly appUrl: string },
): Email {
  if (mail.recipientEmail === null) {
    throw new Error("the proposal e-mail has no address to go to");
  }
  const zone = knownZone(mail.recipientTimeZone);
  const starts = mail.startsAt.map((iso) => new Date(iso));
  const lines = starts.map(
    (start) =>
      `- ${formatLessonDate(start, zone)}, às ${formatLessonTime(start, zone)}`,
  );
  const expires = new Date(mail.expiresAt);
  const count =
    starts.length === 1 ? "uma aula" : `uma série de ${starts.length} aulas`;
  const link = `${options.appUrl}${answerPath(mail.recipient)}`;
  const toStudent = mail.recipient === "student";

  const text = [
    `Olá, ${firstName(mail.recipientName)}.`,
    "",
    `${mail.proposerName} propôs ${count} de inglês de ${mail.durationMinutes} min (fuso ${zone}):`,
    "",
    ...lines,
    "",
    toStudent
      ? "Nada é debitado antes do seu aceite. Ao aceitar, os créditos saem pelo custo da aula do seu plano, e cada aula chega na sua agenda."
      : "Nada é debitado antes do seu aceite. Ao aceitar, os créditos saem do saldo do aluno, e cada aula chega na sua agenda.",
    `A proposta vale até ${formatLessonDate(expires, zone)}, às ${formatLessonTime(expires, zone)}.`,
    "",
    `Para aceitar ou recusar, use a plataforma: ${link}`,
  ];

  const first = starts[0];
  return {
    to: mail.recipientEmail,
    subject: `Proposta de aula · ${formatLessonDate(first, zone)}, ${formatLessonTime(first, zone)}${starts.length > 1 ? ` e mais ${starts.length - 1}` : ""}`,
    text: text.join("\n"),
    replyTo: INVITE_ADDRESS,
    idempotencyKey: proposalIdempotencyKey(mail),
  };
}
