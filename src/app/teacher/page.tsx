import type { Metadata } from "next";
import Link from "next/link";

import { requireTeacher } from "@/lib/content/queries";

export const metadata: Metadata = {
  title: "Professor · Chelsea St",
};

/** Placeholder for this phase. The real teacher area is its own phase. */
export default async function TeacherPage() {
  const { profile } = await requireTeacher();

  return (
    <section className="flex flex-col gap-4">
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        Área do professor
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight">
        Olá, {profile.full_name}.
      </h1>
      <p className="text-muted max-w-prose">
        O link do Meet, os horários e as aulas de cada aluno ficam em{" "}
        <Link href="/teacher/students" className="underline">
          Alunos
        </Link>
        .
      </p>
    </section>
  );
}
