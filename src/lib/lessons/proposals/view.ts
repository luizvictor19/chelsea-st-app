/**
 * What the two screens show of a lesson proposal (#319): the rows of
 * my_lesson_proposals (0057) turned into sentences in the reader's zone. The
 * database decides the state (read against the clock) and who may answer;
 * this only says it, and offers a button where the function would accept the
 * call. Every function takes the zone as an argument, for the reason
 * src/lib/datetime.ts gives.
 */

import { formatLessonDate, formatLessonTime } from "../../datetime.ts";
import { creditsLabel } from "../slots.ts";

/** A row of my_lesson_proposals, the nullable columns said so. */
export type ProposalRow = {
  readonly proposal_id: string;
  readonly my_side: string;
  readonly proposed_by: string;
  readonly status: string;
  readonly teacher_id: string;
  readonly teacher_name: string;
  readonly student_id: string;
  readonly student_name: string;
  readonly expires_at: string;
  readonly starts_at: readonly string[];
  readonly duration_minutes: number | null;
  /** What a lesson costs the student now; null while not on sale. */
  readonly lesson_credits: number | null;
};

/** A period off of the teacher, to warn about a lesson that falls in it. */
export type Busy = { readonly startsAt: string; readonly endsAt: string };

export type ProposalItem = {
  readonly id: string;
  /** "Proposta de Luiz" or "Sua proposta para Ana". */
  readonly title: string;
  /** One line per lesson, in the reader's zone. */
  readonly lessons: readonly string[];
  /** "Aberta até ...", "Aceita", "Recusada"... */
  readonly status: string;
  readonly canAnswer: boolean;
  readonly canWithdraw: boolean;
  /** "3 aulas × 4 créditos = 12 créditos", or null when not on sale. */
  readonly cost: string | null;
  /** What the yes does to the balance, said before it; null for the teacher. */
  readonly balanceNote: string | null;
  /** Whether the yes would be refused for the balance, as far as read now. */
  readonly short: boolean;
  readonly warnings: readonly string[];
};

const STATUS: Readonly<Record<string, string>> = {
  accepted: "Aceita",
  declined: "Recusada",
  withdrawn: "Retirada",
  expired: "Vencida",
};

function lessonLine(iso: string, zone: string): string {
  const start = new Date(iso);
  return `${formatLessonDate(start, zone)}, ${formatLessonTime(start, zone)}`;
}

/** "1 aula", "3 aulas". */
export function lessonsLabel(count: number): string {
  return count === 1 ? "1 aula" : `${count} aulas`;
}

/** How many of `count` lessons at `cost` each a balance covers. */
export function lessonsCovered(
  balance: number,
  cost: number,
  count: number,
): number {
  if (cost <= 0) return count;
  return Math.max(0, Math.min(count, Math.floor(balance / cost)));
}

/**
 * The proposal as the reader sees it. `balance` is the student's own, read
 * on her screen (null on the teacher's, who does not read it); `timeOff` is
 * the teacher's periods off, read on her screen (empty on the student's).
 */
export function proposalItem(
  row: ProposalRow,
  options: {
    readonly zone: string;
    readonly balance: number | null;
    readonly timeOff: readonly Busy[];
  },
): ProposalItem {
  const asStudent = row.my_side === "student";
  const mine = row.proposed_by === row.my_side;
  const open = row.status === "open";
  const count = row.starts_at.length;
  const other = asStudent ? row.teacher_name : row.student_name;
  const total = row.lesson_credits === null ? null : row.lesson_credits * count;
  const cost =
    row.lesson_credits === null || total === null
      ? null
      : `${lessonsLabel(count)} × ${creditsLabel(row.lesson_credits)} = ${creditsLabel(total)}`;

  let balanceNote: string | null = null;
  let short = false;
  if (asStudent && total !== null && options.balance !== null) {
    short = options.balance < total;
    balanceNote = short
      ? `Seu saldo (${creditsLabel(options.balance)}) cobre ${lessonsCovered(options.balance, row.lesson_credits ?? 0, count)} de ${lessonsLabel(count)}. Compre créditos ou peça uma proposta menor.`
      : `Seu saldo: ${creditsLabel(options.balance)}. Depois do aceite: ${creditsLabel(options.balance - total)}.`;
  }

  const minutes = row.duration_minutes ?? 0;
  const warnings = options.timeOff.some((off) =>
    row.starts_at.some((iso) => {
      const start = Date.parse(iso);
      return (
        start < Date.parse(off.endsAt) &&
        start + minutes * 60_000 > Date.parse(off.startsAt)
      );
    }),
  )
    ? ["Uma das aulas cai numa folga sua."]
    : [];

  return {
    id: row.proposal_id,
    title: mine ? `Sua proposta para ${other}` : `Proposta de ${other}`,
    lessons: row.starts_at.map((iso) => lessonLine(iso, options.zone)),
    status: open
      ? `Aberta até ${lessonLine(row.expires_at, options.zone)}`
      : (STATUS[row.status] ?? row.status),
    canAnswer: open && !mine,
    canWithdraw: open && mine,
    cost,
    balanceNote,
    short,
    warnings: open ? warnings : [],
  };
}
