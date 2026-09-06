import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { AccountPending } from "./account-pending";
import { DailyChallenge } from "./daily-challenge";
import { NextLessonCard } from "./next-lesson-card";

export const metadata: Metadata = {
  title: "Minha aula · Chelsea St",
};

/**
 * Wider than any real lesson. Only narrows the rows fetched; the exact test for
 * "has this one finished" happens below, per lesson, against its own duration.
 */
const LONGEST_PLAUSIBLE_LESSON_MINUTES = 8 * 60;

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, timezone")
    .eq("id", user.id)
    .maybeSingle();

  // The teacher signs in through the same door and belongs somewhere else.
  if (profile?.role === "teacher") {
    redirect("/teacher");
  }

  const { data: student } = await supabase
    .from("students")
    .select("meet_url")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !student) {
    return <AccountPending />;
  }

  const now = new Date();
  const earliest = new Date(
    now.getTime() - LONGEST_PLAUSIBLE_LESSON_MINUTES * 60_000,
  );

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, scheduled_at, duration_minutes, meet_url")
    .eq("student_id", user.id)
    .eq("status", "scheduled")
    .gte("scheduled_at", earliest.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(10);

  // The next lesson is the first one that has not finished. Reaching back by the
  // duration rather than cutting at now() is what keeps a lesson that is already
  // running on the screen, because running late is normal.
  const nextLesson = (lessons ?? []).find(
    (lesson) =>
      new Date(lesson.scheduled_at).getTime() +
        lesson.duration_minutes * 60_000 >
      now.getTime(),
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-1">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Chelsea St
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Olá, {profile.full_name}.
        </h1>
      </div>

      {nextLesson ? (
        <NextLessonCard
          scheduledAt={nextLesson.scheduled_at}
          durationMinutes={nextLesson.duration_minutes}
          timeZone={profile.timezone}
          // The room is fixed per student; the lesson column is an override for
          // the odd class that happens somewhere else.
          meetUrl={nextLesson.meet_url ?? student.meet_url}
          serverNow={now.toISOString()}
        />
      ) : (
        <section
          aria-label="Próxima aula"
          className="border-rule bg-surface flex flex-col gap-2 rounded-sm border p-6"
        >
          <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
            Próxima aula
          </p>
          <p className="text-muted">
            Nenhuma aula marcada por enquanto. Quando o professor marcar, ela
            aparece aqui.
          </p>
        </section>
      )}

      <DailyChallenge />
    </main>
  );
}
