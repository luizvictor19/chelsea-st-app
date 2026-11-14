import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

/**
 * The fixed weekly agenda retired on #295 (0054): a lesson is born only by a
 * booking, and its room is the teacher's Meet. lesson_schedules,
 * materialize_lessons, students.meet_url and lessons.meet_url no longer
 * exist, so a screen or a function that names them again fails at run time,
 * not at build time, when it is called through a string. This keeps the
 * criterion of #295 ("no screen or function cites them") standing after the
 * merge. The generated types are left out: they describe the database.
 */

const SRC = join(import.meta.dirname, "../../..");
const TYPES = join(SRC, "lib", "supabase", "types.ts");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

/**
 * A name of the fixed agenda, or a Meet kept on the student or the lesson:
 * dotted, or in a query on either table, up to the end of its statement.
 */
const FIXED_AGENDA =
  /\blesson_schedules\b|\bmaterialize_lessons\b|\b(students|lessons)\.meet_url\b|from\(\s*["'](students|lessons)["']\s*\)[^;]*\bmeet_url\b/u;

test("no file of src/ names the fixed agenda", () => {
  const files = sources(SRC).filter(
    (path) => path !== TYPES && path !== import.meta.filename,
  );
  assert.ok(files.length > 100, "the walk found the sources");
  const citing = files
    .filter((path) => FIXED_AGENDA.test(readFileSync(path, "utf8")))
    .map((path) => relative(SRC, path));
  assert.deepEqual(citing, []);
});

test("the pattern sees each name, and not the teacher's Meet", () => {
  for (const line of [
    `supabase.from("lesson_schedules").select("student_id")`,
    `supabase.rpc("materialize_lessons", { p_student_id: id })`,
    `// the student's room (students.meet_url)`,
    `coalesce(lessons.meet_url, t.meet_url)`,
    `supabase\n  .from("students")\n  .select("id, meet_url, profiles!inner(full_name)")`,
    `supabase.from("lessons").insert({ student_id: id, meet_url: url });`,
  ]) {
    assert.match(line, FIXED_AGENDA);
  }
  for (const line of [
    `.select("id, organization_id, meet_url, calendar_email, is_active")`,
    `teachers.meet_url`,
    `supabase.rpc("lesson_rules")`,
    `supabase.from("teachers").select("id, meet_url, is_active");`,
    `supabase.from("lessons").select("id");\nconst room = teacher.meet_url;`,
  ]) {
    assert.doesNotMatch(line, FIXED_AGENDA);
  }
});
