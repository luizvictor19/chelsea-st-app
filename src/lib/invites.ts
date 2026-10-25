import type { SchoolRole } from "./access.ts";

/** How long an invite stays open, as 0031 sets the default. */
export const INVITE_DAYS = 15;

/** The order the form lists them in: the common case first. */
const ROLE_ORDER: readonly SchoolRole[] = ["student", "teacher", "admin"];

export const ROLE_LABEL: Record<SchoolRole, string> = {
  student: "Aluna",
  teacher: "Professor",
  admin: "Admin da escola",
};

/**
 * The roles someone may invite to one school, mirroring can_invite() in 0031:
 * a platform admin or the school's admin any role, its teacher students only,
 * a student none. The form offers only these; RLS refuses the rest anyway.
 */
export function invitableRoles(
  platformAdmin: boolean,
  rolesInSchool: readonly SchoolRole[],
): SchoolRole[] {
  if (platformAdmin || rolesInSchool.includes("admin")) {
    return [...ROLE_ORDER];
  }
  if (rolesInSchool.includes("teacher")) {
    return ["student"];
  }
  return [];
}

/** The new expiry when an invite is sent again. */
export function renewedExpiry(now: Date): string {
  return new Date(
    now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

/** The part of a PostgREST error this needs. */
export type DatabaseError = {
  readonly code?: string;
  readonly message?: string;
};

/**
 * What the screen says when the database refuses an invite. Each refusal is
 * one rule of 0031; anything else is shown as a generic failure, never as one
 * of these.
 */
export function inviteRefusal(error: DatabaseError): string {
  const message = error.message ?? "";
  if (error.code === "23505") {
    return "Já existe um convite aberto para esse e-mail nesse papel. Use Reenviar na lista.";
  }
  if (error.code === "23514" && message.includes("another school")) {
    return "Essa pessoa já estuda em outra escola. Uma aluna estuda em uma escola só.";
  }
  if (
    error.code === "23514" &&
    message.includes("school_invites_email_check")
  ) {
    return "Digite um e-mail válido.";
  }
  if (error.code === "42501") {
    return "Você não pode convidar alguém nesse papel nessa escola.";
  }
  return "Não foi possível gravar o convite agora. Tente de novo em alguns instantes.";
}
