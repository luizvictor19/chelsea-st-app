import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { destinationFor, manages, practicesOnly, studies } from "@/lib/access";
import { readAccess } from "@/lib/auth";
import { currentSite } from "@/lib/current-site";
import { createClient } from "@/lib/supabase/server";

import { PendingInvites } from "../auth/pending-invites";
import { SignOutButton } from "../auth/sign-out-button";
import { BrandMark } from "../brand-mark";
import { AccountPending } from "./account-pending";
import { DailyChallenge } from "./daily-challenge";
import { NextLessonCard } from "./next-lesson-card";
import { RobinPractice } from "./robin-practice";

export const metadata: Metadata = {
  title: "Minha aula",
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

  const [{ data: profile }, access, { data: student }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, timezone")
      .eq("id", user.id)
      .maybeSingle(),
    readAccess(supabase, user.id),
    supabase
      .from("students")
      .select("meet_url")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  // A teacher, or the admin of a company (0042), signs in through the same
  // door and belongs somewhere else, unless she is also a student: then this
  // screen is hers too, which is how the admin sees what a student sees
  // without a second account. No role at all stays, on the pending screen.
  const home = destinationFor(access);
  if (!studies(access) && home !== "/dashboard") {
    redirect(home);
  }

  if (!profile || !student) {
    return <AccountPending site={await currentSite()} />;
  }

  // An employee of a company without a teacher practises with Robin only: no
  // lesson, no schedule, nothing that speaks of a class.
  if (practicesOnly(access)) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
        <Greeting name={profile.full_name} team={manages(access)} />
        <PendingInvites />
        <RobinPractice />
      </main>
    );
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
      <Greeting name={profile.full_name} team={manages(access)} />

      <PendingInvites />

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

      <Link href="/dashboard/plano" className="text-muted text-sm underline">
        Plano e pagamento
      </Link>
    </main>
  );
}

/** The brand, "Sair da conta" and her name, on top of either dashboard. */
function Greeting({
  name,
  team,
}: {
  readonly name: string;
  /** Also runs a company without a teacher: a way back to /team. */
  readonly team: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <BrandMark />
        <div className="flex items-center gap-4">
          {team ? (
            <Link
              href="/team"
              className="text-muted hover:text-foreground text-sm whitespace-nowrap transition-colors"
            >
              Equipe
            </Link>
          ) : null}
          <SignOutButton />
        </div>
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight">Olá, {name}.</h1>
    </div>
  );
}
