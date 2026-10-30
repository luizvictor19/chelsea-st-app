import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTeacher } from "@/lib/content/queries";
import { formatLessonDate, formatLessonTime } from "@/lib/datetime";

import {
  lessonsLeavingWith,
  runsOutSoon,
  scheduleLabel,
  WEEKS_AHEAD,
} from "../agenda";
import { readAgenda, teacherZone } from "../queries";

import { AgendaView } from "./agenda-view";

export const metadata: Metadata = {
  title: "Agenda · Chelsea St",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "2026-11-02" and "19:00" in `timeZone`: what a date and a time input hold. */
function inputValues(instant: Date, timeZone: string) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  return { date, time };
}

/**
 * One student's agenda. Every date is formatted here, in the teacher's zone,
 * so the browser never formats with a zone of its own.
 */
export default async function StudentAgendaPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Not a uuid is no student; asking Postgres would answer with an error.
  if (!UUID.test(id)) notFound();

  const { supabase, user } = await requireTeacher();
  const now = new Date();
  const [agenda, zone] = await Promise.all([
    readAgenda(supabase, id, now),
    teacherZone(supabase, user.id),
  ]);

  const last = agenda.upcoming.at(-1);
  const lastDate = last === undefined ? null : new Date(last.scheduledAt);
  const warn = agenda.schedules.length > 0 && runsOutSoon(lastDate, now);

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/teacher/students"
          className="text-faint hover:text-foreground font-mono text-xs tracking-[0.16em] uppercase"
        >
          ← Alunos
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">
          {agenda.name}
        </h1>
      </div>

      <AgendaView
        studentId={agenda.id}
        meetUrl={agenda.meetUrl}
        schedules={agenda.schedules.map((schedule) => ({
          id: schedule.id,
          label: scheduleLabel(
            schedule.weekday,
            schedule.startTime,
            schedule.durationMinutes,
          ),
          leaving: lessonsLeavingWith(schedule, agenda.upcoming, now).length,
        }))}
        lessons={agenda.upcoming.map((lesson) => {
          const start = new Date(lesson.scheduledAt);
          return {
            id: lesson.id,
            label: `${formatLessonDate(start, zone)}, ${formatLessonTime(start, zone)}`,
            running: start <= now,
            ...inputValues(start, zone),
          };
        })}
        horizon={
          lastDate === null
            ? "Nenhuma aula agendada."
            : `Aulas geradas até ${formatLessonDate(lastDate, zone)}.`
        }
        warn={warn}
        weeksAhead={WEEKS_AHEAD}
        zone={zone}
      />
    </section>
  );
}
