import type { Metadata } from "next";

import type { SchoolRole } from "@/lib/access";
import { requireTeacher } from "@/lib/content/queries";
import { invitableRoles } from "@/lib/invites";

import { InviteForm, type InvitableSchool } from "./invite-form";
import { InviteList, type OpenInvite } from "./invite-list";

export const metadata: Metadata = {
  title: "Convites · Chelsea St",
};

/**
 * Invite someone to a school, and follow the invites still open. Who may
 * invite whom is the database's rule (0031); the form only offers what the
 * rule allows, so a refusal is the exception and not the way to learn it.
 */
export default async function InvitesPage() {
  const { supabase, user, access } = await requireTeacher();

  const [schools, { data: open, error: openError }] = await Promise.all([
    readInvitableSchools(supabase, user.id, access.platformAdmin),
    supabase
      .from("school_invites")
      .select("id, email, role, expires_at, school_id")
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);
  if (openError) throw new Error(openError.message);

  const nameOf = new Map(schools.map((school) => [school.id, school.name]));
  // A teacher reads every invite of her school but renews and cancels only
  // the student ones (can_invite in 0031); the others show no buttons.
  const rolesFor = new Map(schools.map((school) => [school.id, school.roles]));
  const now = new Date();
  const invites: OpenInvite[] = open.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expires_at,
    expired: new Date(invite.expires_at) <= now,
    manageable: (rolesFor.get(invite.school_id) ?? []).includes(invite.role),
    schoolName: nameOf.get(invite.school_id) ?? null,
  }));

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
          Convites
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Convidar para a escola
        </h1>
        <p className="text-muted max-w-prose">
          A pessoa recebe um e-mail, clica, define a senha e entra. O link do
          e-mail vale por 24 horas; o convite fica aberto por 15 dias. Se o link
          vencer, use Reenviar, ou a pessoa pede um link em “Esqueci minha
          senha” com o mesmo e-mail. Quem já tem conta não recebe e-mail: vê o
          convite ao entrar na plataforma e aceita ali. Avise a pessoa.
        </p>
      </div>

      {schools.length === 0 ? (
        <p className="text-muted">Você não pode convidar ninguém.</p>
      ) : (
        <InviteForm schools={schools} />
      )}

      <InviteList invites={invites} showSchool={schools.length > 1} />
    </section>
  );
}

type Supabase = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

/** The schools this person may invite to, each with the roles she may give. */
async function readInvitableSchools(
  supabase: Supabase,
  userId: string,
  platformAdmin: boolean,
): Promise<InvitableSchool[]> {
  if (platformAdmin) {
    const { data, error } = await supabase
      .from("schools")
      .select("id, name")
      .order("name");
    if (error) throw new Error(error.message);
    return data.map((school) => ({
      ...school,
      roles: invitableRoles(true, []),
    }));
  }

  const { data, error } = await supabase
    .from("school_members")
    .select("role, schools!inner(id, name)")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const bySchool = new Map<string, { name: string; roles: SchoolRole[] }>();
  for (const { role, schools } of data) {
    const entry = bySchool.get(schools.id) ?? { name: schools.name, roles: [] };
    entry.roles.push(role);
    bySchool.set(schools.id, entry);
  }

  return [...bySchool]
    .map(([id, { name, roles }]) => ({
      id,
      name,
      roles: invitableRoles(false, roles),
    }))
    .filter((school) => school.roles.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
