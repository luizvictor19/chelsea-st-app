import type { Database } from "@/lib/supabase/types";

export type OrganizationRole = Database["public"]["Enums"]["organization_role"];

/** One row of organization_members, with whether its organization has a teacher (0042). */
export type Membership = {
  readonly role: OrganizationRole;
  readonly hasTeacher: boolean;
};

/**
 * What the current person may do, as the database records it since 0029: a
 * platform admin above every organization, and one role per row of
 * organization_members. The same person can hold several roles: a teacher
 * who also studies keeps both.
 *
 * This only decides which screen someone lands on. RLS is the real defence.
 */
export type Access = {
  readonly platformAdmin: boolean;
  readonly memberships: readonly Membership[];
};

/**
 * Whoever teaches somewhere, or is above every organization: the /teacher
 * screens. A teacher teaches; an admin teaches only where her organization
 * has a teacher (teaches_in, 0042).
 */
export function teaches(access: Access): boolean {
  return (
    access.platformAdmin ||
    access.memberships.some(
      ({ role, hasTeacher }) =>
        role === "teacher" || (role === "admin" && hasTeacher),
    )
  );
}

/**
 * Who writes content: the platform admin alone (0043, #211). Every row of
 * content is common, and a teacher or an organization's admin only reads it
 * where a lesson needs it. The content screens (Conteúdo, Imagens, Perguntas).
 */
export function writesContent(access: Access): boolean {
  return access.platformAdmin;
}

/**
 * The admin of an organization without a teacher: she invites its people and
 * holds nothing of a teacher's (0042). The /team screen.
 */
export function manages(access: Access): boolean {
  return access.memberships.some(
    ({ role, hasTeacher }) => role === "admin" && !hasTeacher,
  );
}

/** A student somewhere: the /dashboard screens. */
export function studies(access: Access): boolean {
  return access.memberships.some(({ role }) => role === "student");
}

/**
 * A student only of organizations without a teacher: an employee, who
 * practises with Robin and has no lesson, schedule or teacher.
 */
export function practicesOnly(access: Access): boolean {
  const asStudent = access.memberships.filter(({ role }) => role === "student");
  return (
    asStudent.length > 0 && asStudent.every(({ hasTeacher }) => !hasTeacher)
  );
}

/**
 * Where someone goes after signing in. Teaching wins, then running a company:
 * the admin who is also a student lands on her own screen, and /dashboard
 * stays hers by its address. Someone with no role at all still lands on
 * /dashboard, the screen that explains the account is not released yet.
 */
export function destinationFor(
  access: Access,
): "/teacher" | "/team" | "/dashboard" {
  if (teaches(access)) return "/teacher";
  if (manages(access)) return "/team";
  return "/dashboard";
}
