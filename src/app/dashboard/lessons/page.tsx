import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { destinationFor, practicesOnly, studies } from "@/lib/access";
import { readAccess } from "@/lib/auth";
import { formatLessonDate, formatLessonTime } from "@/lib/datetime";
import { proposalItem, type ProposalRow } from "@/lib/lessons/proposals/view";
import { refusalSentence } from "@/lib/lessons/refusals";
import { bookHorizonWeeksFrom } from "@/lib/lessons/rules";
import {
  creditsLabel,
  groupSlotsByDay,
  readWeek,
  weekSpan,
} from "@/lib/lessons/slots";
import { createClient } from "@/lib/supabase/server";

import { LessonsView, ProposalsSection } from "./lessons-view";

export const metadata: Metadata = {
  title: "Aulas",
};

/** A row of my_lessons, with the columns the generated types call non-null. */
type MyLesson = {
  readonly lesson_id: string;
  readonly scheduled_at: string;
  readonly duration_minutes: number;
  readonly teacher_name: string | null;
  readonly meet_url: string | null;
  readonly credits_debited: number;
  readonly credits_refunded: boolean;
  readonly refund_until: string | null;
};

/** A row of bookable_teachers; the cost is null while lessons are not sold. */
type BookableTeacher = {
  readonly teacher_id: string;
  readonly full_name: string;
  readonly lesson_credits: number | null;
};

/** What her cancel would do now, said before she confirms. */
function refundNote(lesson: MyLesson, now: Date, timeZone: string): string {
  if (lesson.credits_debited === 0 || lesson.credits_refunded) {
    return "Esta aula não foi paga com créditos.";
  }
  if (lesson.refund_until !== null && new Date(lesson.refund_until) > now) {
    const until = new Date(lesson.refund_until);
    return `Cancelando até ${formatLessonTime(until, timeZone)} de ${formatLessonDate(until, timeZone)}, ${creditsLabel(lesson.credits_debited)} voltam para o seu saldo.`;
  }
  return "O prazo para a devolução terminou: cancelando agora, os créditos não voltam.";
}

/**
 * The student books a lesson with a teacher and pays in credits (#276), and
 * cancels the ones she booked. The free slots and the cost come from the
 * database (bookable_slots, bookable_teachers); every date is formatted here,
 * in her zone.
 */
export default async function LessonsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, access, { data: student }] = await Promise.all([
    supabase
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle(),
    readAccess(supabase, user.id),
    supabase.from("students").select("id").eq("id", user.id).maybeSingle(),
  ]);
  if (!studies(access)) redirect(destinationFor(access));
  // Whoever only practises has no lesson to book (an organization without a
  // teacher, 0042); the dashboard says what she has.
  if (!profile || !student || practicesOnly(access)) redirect("/dashboard");

  const zone = profile.timezone;
  const now = new Date();
  const [teachersRead, mineRead, balanceRead, rulesRead, proposalsRead] =
    await Promise.all([
      supabase.rpc("bookable_teachers"),
      supabase.rpc("my_lessons"),
      supabase.rpc("credits_balance", { p_person: user.id }),
      supabase.rpc("lesson_rules"),
      supabase.rpc("my_lesson_proposals"),
    ]);
  // The last week the booking reaches, from lesson_rules; this week alone
  // when it cannot be read.
  const horizon = rulesRead.error ? null : bookHorizonWeeksFrom(rulesRead.data);
  const lastWeek = horizon === null ? 0 : horizon - 1;
  const teachers = (teachersRead.data ?? []) as BookableTeacher[];
  const mine = (mineRead.data ?? []) as MyLesson[];

  const professor = Array.isArray(params.professor)
    ? params.professor[0]
    : params.professor;
  const chosen =
    teachers.find((teacher) => teacher.teacher_id === professor) ?? teachers[0];
  const week = readWeek(params.semana, lastWeek);
  const span = weekSpan(now, week);
  const slotsRead =
    chosen === undefined
      ? null
      : await supabase.rpc("bookable_slots", {
          p_teacher: chosen.teacher_id,
          p_from: span.from.toISOString(),
          p_to: span.to.toISOString(),
        });

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link href="/dashboard" className="text-muted text-sm underline">
          Voltar
        </Link>
        <h1 className="text-3xl font-extrabold tracking-tight">Aulas</h1>
        <p className="text-muted">
          {balanceRead.error
            ? "Não foi possível ler o seu saldo agora."
            : `Seu saldo: ${creditsLabel(balanceRead.data)}.`}{" "}
          <Link href="/dashboard/plano" className="underline">
            Plano e créditos
          </Link>
        </p>
      </div>

      <LessonsView
        readError={
          teachersRead.error
            ? refusalSentence(teachersRead.error.message)
            : slotsRead?.error
              ? refusalSentence(slotsRead.error.message)
              : mineRead.error
                ? refusalSentence(mineRead.error.message)
                : null
        }
        mine={mine.map((lesson) => {
          const start = new Date(lesson.scheduled_at);
          return {
            id: lesson.lesson_id,
            label: `${formatLessonDate(start, zone)}, ${formatLessonTime(start, zone)}`,
            teacher: lesson.teacher_name,
            meetUrl: lesson.meet_url,
            refundNote: refundNote(lesson, now, zone),
            started: start <= now,
            // A lesson of the fixed agenda has no teacher: its student did
            // not book it and does not cancel it (cancel_lesson, 0052).
            booked: lesson.teacher_name !== null,
          };
        })}
        teachers={teachers.map((teacher) => ({
          id: teacher.teacher_id,
          name: teacher.full_name,
        }))}
        chosen={
          chosen === undefined
            ? null
            : {
                id: chosen.teacher_id,
                name: chosen.full_name,
                credits: chosen.lesson_credits,
              }
        }
        balance={balanceRead.error ? null : balanceRead.data}
        week={week}
        lastWeek={lastWeek}
        days={groupSlotsByDay(
          (slotsRead?.data ?? []).map((slot) => slot.starts_at),
          zone,
        )}
        zone={zone}
      />

      <ProposalsSection
        items={((proposalsRead.data ?? []) as ProposalRow[])
          .filter((row) => row.my_side === "student")
          .map((row) =>
            proposalItem(row, {
              zone,
              balance: balanceRead.error ? null : balanceRead.data,
              timeOff: [],
            }),
          )}
        teachers={
          // Proposing needs a cost: none while lessons are not on sale.
          teachers
            .filter((teacher) => teacher.lesson_credits !== null)
            .map((teacher) => ({
              id: teacher.teacher_id,
              name: teacher.full_name,
            }))
        }
        zone={zone}
      />
    </main>
  );
}
