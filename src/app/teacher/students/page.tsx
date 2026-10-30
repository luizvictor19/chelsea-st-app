import type { Metadata } from "next";
import Link from "next/link";

import { requireTeacher } from "@/lib/content/queries";
import { formatLessonDate, formatLessonTime } from "@/lib/datetime";

import { runsOutSoon } from "./agenda";
import { listStudents, teacherZone } from "./queries";

export const metadata: Metadata = {
  title: "Alunos · Chelsea St",
};

const DAY = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
  }).format(date);

/** Every student, with what her agenda is missing said on her row. */
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
          Abra um aluno para colar o link do Meet, cadastrar os horários da
          semana e remarcar ou cancelar uma aula. Quem ainda não aparece aqui
          entra pela tela de{" "}
          <Link href="/teacher/invites" className="underline">
            Convites
          </Link>
          .
        </p>
      </div>

      {students.length === 0 ? (
        <p className="text-muted">Nenhum aluno ativo ainda.</p>
      ) : (
        <ul className="border-rule divide-rule divide-y rounded-sm border">
          {students.map((student) => {
            const next = student.next === null ? null : new Date(student.next);
            const last = student.last === null ? null : new Date(student.last);
            const warnings = [
              student.meetUrl === null ? "sem link do Meet" : null,
              student.scheduleCount === 0 ? "sem horários" : null,
              student.scheduleCount > 0 && runsOutSoon(last, now)
                ? last === null
                  ? "nenhuma aula gerada"
                  : `aulas só até ${DAY(last, zone)}`
                : null,
            ].filter((text) => text !== null);
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
                        ? "sem aula agendada"
                        : `${formatLessonDate(next, zone)}, ${formatLessonTime(next, zone)}`}
                    </span>
                  </div>
                  {warnings.length > 0 ? (
                    <span className="text-accent text-sm">
                      {warnings.join(" · ")}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
