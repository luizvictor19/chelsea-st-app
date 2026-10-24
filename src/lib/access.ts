import type { Database } from "@/lib/supabase/types";

export type SchoolRole = Database["public"]["Enums"]["school_role"];

/**
 * What the current person may do, as the database records it since 0029: a
 * platform admin above every school, and one role per row of school_members.
 * The same person can hold several, which is how an admin also opens the
 * student's screens without a second account.
 *
 * This only decides which screen someone lands on. RLS is the real defence.
 */
export type Access = {
  readonly platformAdmin: boolean;
  readonly roles: readonly SchoolRole[];
};

/** Admin or teacher somewhere, or above every school: the /teacher screens. */
export function teaches(access: Access): boolean {
  return (
    access.platformAdmin ||
    access.roles.some((role) => role === "admin" || role === "teacher")
  );
}

/** A student somewhere: the /dashboard screens. */
export function studies(access: Access): boolean {
  return access.roles.includes("student");
}

/**
 * Where someone goes after signing in. Teaching wins: the admin who is also a
 * student lands on /teacher and opens /dashboard from there. Someone with no
 * role at all still lands on /dashboard, the screen that explains the account
 * is not released yet.
 */
export function destinationFor(access: Access): "/teacher" | "/dashboard" {
  return teaches(access) ? "/teacher" : "/dashboard";
}
