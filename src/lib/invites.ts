import type { OrganizationRole } from "./access.ts";

/** How long an invite stays open, as 0031 sets the default. */
export const INVITE_DAYS = 15;

/** The order the form lists them in: the common case first. */
const ROLE_ORDER: readonly OrganizationRole[] = ["student", "teacher", "admin"];

/**
 * A role as an organization with a teacher names it. Not exported: a role is
 * named through roleLabel, with the organization's kind, never from this
 * table alone (the bug of #213).
 */
const ROLE_LABEL: Record<OrganizationRole, string> = {
  student: "Aluna",
  teacher: "Professor",
  admin: "Admin da escola",
};

/** A role as a company without a teacher names it (0042). */
const COMPANY_ROLE_LABEL: Record<OrganizationRole, string> = {
  student: "Funcionário",
  teacher: "Professor",
  admin: "Admin da empresa",
};

/** The name of a role in an organization with or without a teacher. */
export function roleLabel(role: OrganizationRole, hasTeacher: boolean): string {
  return (hasTeacher ? ROLE_LABEL : COMPANY_ROLE_LABEL)[role];
}

/**
 * The role an open invite offers, named as its organization names it. The
 * invited person is not a member yet and cannot read organizations, so the
 * kind comes with the invite (my_open_organization_invites, 0046, #213).
 *
 * Read as unknown and not as the type says: a database still on 0040's
 * function (the code merged before 0046 is pushed, or a schema cache behind)
 * gives no has_teacher, and roleLabel would read that as a company and call
 * a school's student "Funcionário". Without a boolean, the school's names,
 * which is what the screen said before 0046.
 */
export function invitedAs(invite: {
  readonly role: OrganizationRole;
  readonly has_teacher: unknown;
}): string {
  return roleLabel(
    invite.role,
    typeof invite.has_teacher === "boolean" ? invite.has_teacher : true,
  );
}

/**
 * The roles someone may invite to one organization, mirroring can_invite() in 0031:
 * a platform admin or the organization's admin any role, its teacher students only,
 * a student none. Where the organization has no teacher, nobody is invited as
 * one (0042). Where it takes signups (open_signup, 0051), nobody is invited as
 * a student: the signup is that door (#292, 13/11), and the screen stops
 * offering it, while the database still accepts it. The form offers only
 * these; the database refuses the rest anyway.
 */
export function invitableRoles(
  platformAdmin: boolean,
  rolesInOrganization: readonly OrganizationRole[],
  hasTeacher: boolean,
  openSignup = false,
): OrganizationRole[] {
  const offered = (role: OrganizationRole) =>
    (hasTeacher || role !== "teacher") && !(openSignup && role === "student");
  if (platformAdmin || rolesInOrganization.includes("admin")) {
    return ROLE_ORDER.filter(offered);
  }
  if (rolesInOrganization.includes("teacher")) {
    return ["student" as const].filter(offered);
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
 * one rule of 0031 or 0042; anything else is shown as a generic failure, never as one
 * of these. Since 0032 none of them depends on the person: where she studies
 * is checked when she accepts, so the inviting organization is never told.
 */
export function inviteRefusal(error: DatabaseError): string {
  const message = error.message ?? "";
  if (error.code === "23505") {
    return "Já existe um convite aberto para esse e-mail nesse papel. Use Reenviar na lista.";
  }
  if (
    error.code === "23514" &&
    message.includes("organization_invites_email_check")
  ) {
    return "Digite um e-mail válido.";
  }
  if (
    error.code === "23514" &&
    message.includes("teacher_needs_a_teaching_organization")
  ) {
    return "Essa organização não tem professor: convide como funcionário ou admin.";
  }
  if (error.code === "42501") {
    return "Você não pode convidar alguém nesse papel nessa organização.";
  }
  return "Não foi possível gravar o convite agora. Tente de novo em alguns instantes.";
}

/**
 * What the inviter is told after the invite email was asked for, by the
 * error of inviteUserByEmail: null when there is nothing to say beyond
 * "sent". email_exists is a confirmed account: Supabase mails her nothing, she
 * sees the invite when she signs in (0032), and saying anything else would
 * tell the inviter she has an account. The whole error is read, not just its
 * code: a network failure has no code, and it did not send anything.
 */
export function mailProblem(error: DatabaseError | null): string | null {
  if (error === null || error.code === "email_exists") {
    return null;
  }
  if (error.code === "over_email_send_rate_limit") {
    return "O convite foi gravado, mas o limite de e-mails do Supabase foi atingido. Use Reenviar daqui a alguns minutos.";
  }
  return "O convite foi gravado, mas o e-mail não saiu. Use Reenviar daqui a alguns minutos.";
}

/**
 * What the invited person reads when accept_my_organization_invite (0032) refuses.
 * Each refusal is one rule of the function; anything else is generic.
 */
export function acceptRefusal(error: DatabaseError): string {
  const message = error.message ?? "";
  if (error.code === "23514" && message.includes("not open for this account")) {
    return "Esse convite venceu ou já foi usado. Peça um novo a quem convidou você.";
  }
  if (error.code === "23514" && message.includes("another organization")) {
    // Neutral on purpose (#239): a school's student invited as a company's
    // employee meets this refusal too, and the role is student in both.
    return "Você já faz parte de outra organização como aluna ou funcionário. Cada pessoa participa de uma organização só nesse papel.";
  }
  return "Não foi possível aceitar o convite agora. Tente de novo em alguns instantes.";
}
