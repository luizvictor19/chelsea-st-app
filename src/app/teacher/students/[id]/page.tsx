import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireTeacher } from "@/lib/content/queries";
import { formatLessonDate, formatLessonTime } from "@/lib/datetime";

import { mayCancel } from "../agenda";
import { progressLine } from "../progress";
import { readAgenda, readCancelRights, teacherZone } from "../queries";

import { AgendaView } from "./agenda-view";

export const metadata: Metadata = {
  title: "Agenda",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One student's booked lessons and where she stopped. Every date is
 * formatted here, in the teacher's zone, so the browser never formats with a
 * zone of its own.
 */
export default async function StudentAgendaPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Not a uuid is no student; asking Postgres would answer with an error.
  if (!UUID.test(id)) notFound();

  const { supabase, user, access } = await requireTeacher();
  const now = new Date();
  const [agenda, zone, rights] = await Promise.all([
    readAgenda(supabase, id, now),
    teacherZone(supabase, user.id),
    readCancelRights(supabase, user.id, access.platformAdmin),
  ]);

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
          Agenda de {agenda.name}
        </h1>
        <p className="text-muted">{progressLine(agenda.progress)}</p>
      </div>

      <AgendaView
        lessons={agenda.upcoming.map((lesson) => {
          const start = new Date(lesson.scheduledAt);
          return {
            id: lesson.id,
            label: `${formatLessonDate(start, zone)}, ${formatLessonTime(start, zone)}`,
            running: start <= now,
            cancellable: mayCancel(rights, lesson),
          };
        })}
      />
    </section>
  );
}
