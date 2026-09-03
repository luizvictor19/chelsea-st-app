import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Professor — Chelsea St",
};

/** Placeholder for this phase. The real teacher area is its own phase. */
export default async function TeacherPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "teacher") {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        Área do professor
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight">
        Olá, {profile.full_name}.
      </h1>
      <p className="text-muted">
        Esta área ainda não faz nada. Por enquanto, aulas e horários são criados
        direto no banco.
      </p>
    </main>
  );
}
