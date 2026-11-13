import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { destinationFor, manages, practicesOnly, studies } from "@/lib/access";
import { readAccess } from "@/lib/auth";
import { billingOpen } from "@/lib/billing/server";
import { currentSite } from "@/lib/current-site";
import { createClient } from "@/lib/supabase/server";

import { PendingInvites } from "../auth/pending-invites";
import { SignOutButton } from "../auth/sign-out-button";
import { BrandMark } from "../brand-mark";
import { AccountPending } from "./account-pending";
import { DailyChallenge } from "./daily-challenge";
import { NextLessonCard } from "./next-lesson-card";
import { readPlanScreen } from "./plano/queries";
import { RobinPractice } from "./robin-practice";
import { StartTrialCard } from "./start-trial-card";

export const metadata: Metadata = {
  title: "Minha aula",
};

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
    supabase.from("students").select("id").eq("id", user.id).maybeSingle(),
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
  const [{ data: lessons }, startsTrial] = await Promise.all([
    // Her lessons not finished yet, soonest first, with the room: the Meet of
    // the lesson's teacher (#276), for every lesson since #295. A lesson
    // still running is in it: running late is normal.
    supabase.rpc("my_lessons"),
    offersTrial(supabase, user.id),
  ]);
  const nextLesson = (lessons ?? []).at(0);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <Greeting name={profile.full_name} team={manages(access)} />

      <PendingInvites />

      {startsTrial && <StartTrialCard />}

      {nextLesson ? (
        <NextLessonCard
          scheduledAt={nextLesson.scheduled_at}
          durationMinutes={nextLesson.duration_minutes}
          timeZone={profile.timezone}
          // Null when the teacher has no room set (she stopped taking
          // bookings): the generated types call every column of a function's
          // table non-null.
          meetUrl={nextLesson.meet_url as string | null}
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
          <p className="text-muted">Nenhuma aula marcada por enquanto.</p>
          <Link
            href="/dashboard/lessons"
            className="bg-accent text-accent-foreground self-start rounded-sm px-5 py-3 font-semibold transition-colors hover:opacity-90"
          >
            Reservar aula
          </Link>
        </section>
      )}

      <DailyChallenge />

      <div className="flex flex-wrap gap-4">
        <Link
          href="/dashboard/lessons"
          className="text-muted text-sm underline"
        >
          Aulas
        </Link>
        <Link href="/dashboard/plano" className="text-muted text-sm underline">
          Plano e pagamento
        </Link>
      </div>
    </main>
  );
}

/**
 * A student of a chelsea-st organization, while the subscription is open, to
 * whom /dashboard/plano would offer the trial now (#275): no subscription
 * alive (an unfinished checkout does not count), the trial never used, and a
 * plan on sale with trial days. The same conditions the plan screen reads,
 * from the same query, so the card never promises what that screen does not
 * offer. A read that fails shows no card: never offer a trial on a guess.
 */
async function offersTrial(
  supabase: Awaited<ReturnType<typeof createClient>>,
  personId: string,
): Promise<boolean> {
  if (!billingOpen()) {
    return false;
  }
  const { data: chelsea } = await supabase
    .from("organization_members")
    .select("organizations!inner(brand)")
    .eq("user_id", personId)
    .eq("role", "student")
    .eq("organizations.brand", "chelsea-st")
    .limit(1);
  if ((chelsea ?? []).length === 0) {
    return false;
  }
  try {
    const { plans, current, trialUsed } = await readPlanScreen(personId);
    const alive =
      current !== null &&
      current.status !== "canceled" &&
      current.status !== "pending";
    return !alive && !trialUsed && (plans[0]?.trialDays ?? 0) > 0;
  } catch {
    return false;
  }
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
