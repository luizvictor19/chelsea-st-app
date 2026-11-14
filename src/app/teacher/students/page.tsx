import type { Metadata } from "next";
import Link from "next/link";

import { requireTeacher } from "@/lib/content/queries";
import { formatLessonDate, formatLessonTime } from "@/lib/datetime";

import { progressLine } from "./progress";
import { listStudents, teacherZone } from "./queries";

export const metadata: Metadata = {
  title: "Alunos",
};

/** Every student, with her next booked lesson and where she stopped. */
export default async function StudentsPage() {
  const { supabase, user } = await requireTeacher();
  const now = new Date();
  const [students, zone] = await Promise.all([
    listStudents(supabase, now),
    teacherZone(supabase, user.id),
  ]);

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Alunos
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Agenda dos alunos
        </h1>
        <p className="text-muted max-w-prose">
          Abra um aluno para ver as aulas reservadas e cancelar uma delas. O
          aluno reserva pela agenda dele, nos horários que você abre em{" "}
          <Link href="/teacher/agenda" className="underline">
            Agenda
          </Link>
          . O aluno entra se cadastrando pelo site.
        </p>
      </div>

      {students.length === 0 ? (
        <p className="text-muted">Nenhum aluno ativo ainda.</p>
      ) : (
        <ul className="border-rule divide-rule divide-y rounded-sm border">
          {students.map((student) => {
            const next = student.next === null ? null : new Date(student.next);
            return (
              <li key={student.id}>
                <Link
                  href={`/teacher/students/${student.id}`}
                  className="hover:bg-surface flex flex-wrap items-center justify-between gap-3 p-4 transition-colors"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-semibold">{student.name}</span>
                    <span className="text-muted text-sm first-letter:uppercase">
                      {next === null
                        ? "nenhuma aula reservada"
                        : `${formatLessonDate(next, zone)}, ${formatLessonTime(next, zone)}`}
                    </span>
                    <span className="text-muted text-sm">
                      {progressLine(student.progress)}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
