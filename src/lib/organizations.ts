import type { BrandKey } from "./brand.ts";
import { looksLikeEmail, normalizeEmail } from "./credentials.ts";
import type { DatabaseError } from "./invites.ts";

/**
 * What every company's organization is (ADR 0005, 0042): GrifoAI's brand and
 * no teacher. Fixed here, not asked on the form, so the screen cannot create a
 * company with a teacher by accident (#205).
 */
export const COMPANY: { readonly brand: BrandKey; readonly hasTeacher: false } =
  { brand: "grifoai", hasTeacher: false };

/** organizations_slug_check (0029, renamed in 0040), held by organizations.test.ts. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const NAME_MISSING = "Digite o nome da empresa.";
const SLUG_INVALID =
  "O endereço usa só letras minúsculas sem acento, números e hífens entre eles.";
const EMAIL_INVALID = "Digite o e-mail do primeiro admin.";

/**
 * The slug a name suggests: accents dropped, lower case, every other run of
 * characters one hyphen, none at either end. Empty when nothing is left, which
 * the form refuses.
 */
export function slugFromName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type CompanyForm = {
  readonly name: string;
  readonly slug: string;
  readonly email: string;
};

/**
 * The form of a new company, read whole before the first write: a bad email
 * found after the organization is created would leave it with no admin.
 * Each field as the database stores it, or the first problem in the order
 * the form shows them.
 */
export function readCompanyForm(fields: {
  readonly name: unknown;
  readonly slug: unknown;
  readonly email: unknown;
}):
  | { readonly ok: true; readonly company: CompanyForm }
  | { readonly ok: false; readonly message: string } {
  const name = String(fields.name ?? "").trim();
  const slug = String(fields.slug ?? "").trim();
  const email = normalizeEmail(fields.email);

  if (name === "") return { ok: false, message: NAME_MISSING };
  if (!SLUG.test(slug)) return { ok: false, message: SLUG_INVALID };
  if (!looksLikeEmail(email)) return { ok: false, message: EMAIL_INVALID };
  return { ok: true, company: { name, slug, email } };
}

/**
 * What the screen says when the database refuses the organization. Each
 * refusal is one constraint of organizations or organizations_write;
 * anything else is generic, never one of these.
 */
export function organizationRefusal(error: DatabaseError): string {
  const message = error.message ?? "";
  if (error.code === "23505" && message.includes("organizations_slug_key")) {
    return "Já existe uma organização com esse endereço. Escolha outro.";
  }
  if (error.code === "23514" && message.includes("organizations_slug_check")) {
    return SLUG_INVALID;
  }
  if (error.code === "23514" && message.includes("organizations_name_check")) {
    return NAME_MISSING;
  }
  if (error.code === "42501") {
    return "Só o administrador da plataforma cria organizações.";
  }
  return "Não foi possível criar a empresa agora. Tente de novo em alguns instantes.";
}

/** The organization exists, its admin invite was refused (inviteRefusal). */
export function createdButNotInvited(reason: string): string {
  return `A empresa foi criada, mas o convite não foi gravado. ${reason} Convide o admin em Convites.`;
}

/** The organization and the invite exist, the email did not go (mailProblem). */
export function createdButNotMailed(problem: string): string {
  return `A empresa foi criada. ${problem} Reenviar fica em Convites.`;
}

/**
 * How an organization stands for an admin: its admin members, and its admin
 * invites still open (not accepted, not expired). Both zero is an
 * organization nobody runs, which the list says (#205).
 */
export function adminCount(
  members: readonly { readonly role: string }[],
  invites: readonly {
    readonly role: string;
    readonly accepted_at: string | null;
    readonly expires_at: string;
  }[],
  now: Date,
): { readonly admins: number; readonly openAdminInvites: number } {
  return {
    admins: members.filter((member) => member.role === "admin").length,
    openAdminInvites: invites.filter(
      (invite) =>
        invite.role === "admin" &&
        invite.accepted_at === null &&
        new Date(invite.expires_at).getTime() > now.getTime(),
    ).length,
  };
}
