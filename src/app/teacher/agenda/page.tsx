import type { Metadata } from "next";

import { requireTeacher } from "@/lib/content/queries";
import { formatLessonDate, formatLessonTime } from "@/lib/datetime";
import { creditsLabel } from "@/lib/lessons/slots";

import { WEEKDAYS } from "../students/agenda";
import { progressLine } from "../students/progress";
import { teacherZone } from "../students/queries";

import { TeacherAgendaView } from "./agenda-view";
import { readTeacherAgenda } from "./queries";

export const metadata: Metadata = {
  title: "Agenda",
};

/** "24/12" in `timeZone`. */
function dayMonth(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
  }).format(instant);
}

/**
 * The teacher's side of the booking (#276): her profile, the hours she
 * takes bookings in and the lessons booked with her. Every date is formatted
 * here, in her zone.
 */
export default async function TeacherAgendaPage() {
  const { supabase, user } = await requireTeacher();
  const now = new Date();
  const [agenda, zone] = await Promise.all([
    readTeacherAgenda(supabase, user.id, now),
    teacherZone(supabase, user.id),
  ]);
  const organization = agenda.teachable[0];

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Agenda
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Horários para reserva
        </h1>
        <p className="text-muted max-w-prose">
          O aluno reserva um horário livre e paga com créditos. Cada aula tem a
          duração que o sistema define, e os horários começam a cada hora dentro
          das janelas.
        </p>
      </div>

      {organization === undefined ? (
        <p className="text-muted">
          Você não ensina em nenhuma organização com professor, então não há
          agenda de reservas aqui.
        </p>
      ) : (
        <TeacherAgendaView
          organizationId={organization.organizationId}
          organizationName={organization.name}
          profile={agenda.profile}
          zone={zone}
          windows={agenda.windows.map((w) => ({
            id: w.id,
            label: `${WEEKDAYS[w.weekday]}, ${w.startTime} às ${w.endTime}`,
            otherZone: w.timeZone === zone ? null : w.timeZone,
          }))}
          timeOff={agenda.timeOff.map((t) => {
            const start = new Date(t.startsAt);
            // ends_at is the midnight after the last day off.
            const last = new Date(new Date(t.endsAt).getTime() - 1);
            const from = dayMonth(start, zone);
            const to = dayMonth(last, zone);
            return { id: t.id, label: from === to ? from : `${from} a ${to}` };
          })}
          lessons={agenda.lessons.map((lesson) => {
            const start = new Date(lesson.scheduledAt);
            return {
              id: lesson.id,
              label: `${formatLessonDate(start, zone)}, ${formatLessonTime(start, zone)}`,
              student: lesson.studentName,
              running: start <= now,
              progress: progressLine(lesson.progress),
              lastNote: lesson.lastNote,
              inviteWarnings: lesson.inviteWarnings,
              refund:
                lesson.creditsDebited > 0
                  ? `O aluno recebe ${creditsLabel(lesson.creditsDebited)} de volta.`
                  : "Aula sem créditos.",
            };
          })}
        />
      )}
    </section>
  );
}
