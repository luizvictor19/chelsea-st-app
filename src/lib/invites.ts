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
 * of these. Since 0032 none of them depends on the person: where she studies
 * is checked when she accepts, so the inviting school is never told.
 */
export function inviteRefusal(error: DatabaseError): string {
  const message = error.message ?? "";
  if (error.code === "23505") {
    return "Já existe um convite aberto para esse e-mail nesse papel. Use Reenviar na lista.";
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

/**
 * What the inviter is told after the invite email was asked for, by the
 * error code of inviteUserByEmail: null when there is nothing to say beyond
 * "sent". email_exists is a confirmed account: Supabase mails her nothing, she
 * sees the invite when she signs in (0032), and saying anything else would
 * tell the inviter she has an account.
 */
export function mailProblem(code: string | undefined): string | null {
  if (code === undefined || code === "email_exists") {
    return null;
  }
  if (code === "over_email_send_rate_limit") {
    return "O convite foi gravado, mas o limite de e-mails do Supabase foi atingido. Use Reenviar daqui a alguns minutos.";
  }
  return "O convite foi gravado, mas o e-mail não saiu. Use Reenviar daqui a alguns minutos.";
}

/**
 * What the invited person reads when accept_my_school_invite (0032) refuses.
 * Each refusal is one rule of the function; anything else is generic.
 */
export function acceptRefusal(error: DatabaseError): string {
  const message = error.message ?? "";
  if (error.code === "23514" && message.includes("not open for this account")) {
    return "Esse convite venceu ou já foi usado. Peça um novo a quem convidou você.";
  }
  if (error.code === "23514" && message.includes("another school")) {
    return "Você já estuda em outra escola. Uma aluna estuda em uma escola só.";
  }
  return "Não foi possível aceitar o convite agora. Tente de novo em alguns instantes.";
}
