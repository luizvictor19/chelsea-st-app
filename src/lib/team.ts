import { DAILY_PRACTICE_MINUTES } from "./tutor/daily-cap.ts";

/**
 * The team panel of /team (#198): what the admin of an organization without a
 * teacher sees of her people's practice. Only what team_practice (0044) lets
 * out: the days practised by week, the last day, the minutes of the month.
 * Never what was said. Pure, so what the screen shows is tested here.
 */

/** How many weeks the panel shows, this one last. team_practice takes 1 to 12. */
export const TEAM_WEEKS = 4;

/** A row of organization_members with the role student: someone who joined. */
export type TeamMember = {
  readonly userId: string;
  readonly organizationId: string;
  /** When the invite was accepted (organization_members.created_at). */
  readonly joinedAt: string;
};

export type TeamProfile = {
  readonly id: string;
  readonly fullName: string;
  readonly timeZone: string;
};

/** A row of team_practice, with the organization it was asked for. */
export type TeamPractice = {
  readonly organizationId: string;
  readonly personId: string;
  /** YYYY-MM-DD in her zone, or null when she never practised. */
  readonly lastPractisedOn: string | null;
  /** Oldest week first; the last one is this week. */
  readonly daysByWeek: readonly number[];
  readonly minutesThisMonth: number;
};

export type TeamRow = {
  readonly id: string;
  readonly name: string;
  /** "03/11" */
  readonly joinedOn: string;
  readonly lastPractisedOn: string | null;
  /** "Hoje", "Ontem", "02/11" or "Ainda não praticou". */
  readonly lastPractice: string;
  readonly daysByWeek: readonly number[];
  readonly practisedThisWeek: boolean;
  readonly minutesThisMonth: number;
  /** The daily cap times the days of her month so far, today included. */
  readonly minutesAvailable: number;
};

export type TeamSummary = {
  readonly people: number;
  readonly practisedThisWeek: number;
  readonly minutesThisMonth: number;
  readonly minutesAvailable: number;
};

/** The calendar date as seen in `timeZone`, as YYYY-MM-DD. */
function localDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** A YYYY-MM-DD as a UTC midnight, for whole-day arithmetic. */
function dayAsUtc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** "30/10", from a YYYY-MM-DD. */
function dayMonth(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}

/** "Hoje", "Ontem", "30/10", or "Ainda não praticou". Both days in her zone. */
export function lastPracticeLabel(day: string | null, today: string): string {
  if (day === null) return "Ainda não praticou";
  const behind = Math.round(
    (dayAsUtc(today).getTime() - dayAsUtc(day).getTime()) / 86_400_000,
  );
  if (behind === 0) return "Hoje";
  if (behind === 1) return "Ontem";
  return dayMonth(day);
}

/**
 * The Monday of each of the last `weeks` weeks in `timeZone`, oldest first,
 * as "26/10": the labels over the days of team_practice, whose weeks start on
 * Monday too.
 */
export function weekLabels(
  now: Date,
  timeZone: string,
  weeks: number,
): string[] {
  const today = dayAsUtc(localDay(now, timeZone));
  const sinceMonday = (today.getUTCDay() + 6) % 7;
  const monday = today.getTime() - sinceMonday * 86_400_000;
  return Array.from({ length: weeks }, (_, index) => {
    const back = weeks - 1 - index;
    const date = new Date(monday - back * 7 * 86_400_000);
    return dayMonth(date.toISOString().slice(0, 10));
  });
}

/**
 * The people of one organization who joined, with their practice, in the
 * order the admin reads them: whoever never practised first, then whoever
 * practised longest ago, ties by name. Only rows of `organizationId` are
 * used, whatever else the inputs hold.
 */
export function teamOf({
  organizationId,
  members,
  profiles,
  practice,
  now,
}: {
  readonly organizationId: string;
  readonly members: readonly TeamMember[];
  readonly profiles: readonly TeamProfile[];
  readonly practice: readonly TeamPractice[];
  readonly now: Date;
}): TeamRow[] {
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const practiceById = new Map(
    practice
      .filter((row) => row.organizationId === organizationId)
      .map((row) => [row.personId, row]),
  );
  const seen = new Set<string>();
  const rows: TeamRow[] = [];

  for (const m of members) {
    if (m.organizationId !== organizationId || seen.has(m.userId)) continue;
    seen.add(m.userId);

    const profile = profileById.get(m.userId);
    // The column's default, which every profile without a zone set holds.
    const timeZone = profile?.timeZone ?? "America/Sao_Paulo";
    const today = localDay(now, timeZone);
    const own = practiceById.get(m.userId);
    const daysByWeek = own?.daysByWeek ?? Array<number>(TEAM_WEEKS).fill(0);
    const lastPractisedOn = own?.lastPractisedOn ?? null;

    rows.push({
      id: m.userId,
      name: profile?.fullName ?? "Sem nome",
      joinedOn: dayMonth(localDay(new Date(m.joinedAt), timeZone)),
      lastPractisedOn,
      lastPractice: lastPracticeLabel(lastPractisedOn, today),
      daysByWeek,
      practisedThisWeek: (daysByWeek.at(-1) ?? 0) > 0,
      minutesThisMonth: own?.minutesThisMonth ?? 0,
      minutesAvailable: DAILY_PRACTICE_MINUTES * Number(today.slice(8, 10)),
    });
  }

  return rows.sort((a, b) => {
    if (a.lastPractisedOn !== b.lastPractisedOn) {
      if (a.lastPractisedOn === null) return -1;
      if (b.lastPractisedOn === null) return 1;
      return a.lastPractisedOn < b.lastPractisedOn ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

/** The line over the list, and the team's month. */
export function teamSummary(rows: readonly TeamRow[]): TeamSummary {
  return {
    people: rows.length,
    practisedThisWeek: rows.filter((row) => row.practisedThisWeek).length,
    minutesThisMonth: rows.reduce((sum, row) => sum + row.minutesThisMonth, 0),
    minutesAvailable: rows.reduce((sum, row) => sum + row.minutesAvailable, 0),
  };
}

/** "3 de 8 praticaram esta semana." */
export function summaryLine(summary: TeamSummary): string {
  const verb = summary.practisedThisWeek === 1 ? "praticou" : "praticaram";
  return `${summary.practisedThisWeek} de ${summary.people} ${verb} esta semana.`;
}

/** "45 min", "1h", "1h05". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
}
