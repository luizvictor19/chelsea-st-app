import { requireTeacher } from "@/lib/content/queries";

type Supabase = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

export type LessonStudent = { readonly id: string; readonly name: string };

/** The active students the reader teaches, by name. RLS decides which. */
export async function loadStudents(
  supabase: Supabase,
): Promise<LessonStudent[]> {
  const { data, error } = await supabase
    .from("students")
    .select("id, profiles!inner(full_name)")
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return data
    .map((row) => ({ id: row.id, name: row.profiles.full_name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** The point her latest marked lesson stopped at, or null if none is marked. */
export async function lastStop(
  supabase: Supabase,
  studentId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("lessons")
    .select("scheduled_at, points!lessons_stopped_at_point_fkey(number)")
    .eq("student_id", studentId)
    .not("stopped_at_point_id", "is", null)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.points?.number ?? null;
}
