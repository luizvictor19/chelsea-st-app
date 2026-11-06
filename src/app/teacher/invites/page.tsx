import type { Metadata } from "next";

import type { OrganizationRole } from "@/lib/access";
import { requireTeacher } from "@/lib/content/queries";
import { invitableRoles } from "@/lib/invites";

import { InviteForm, type InvitableOrganization } from "./invite-form";
import { InviteList, type OpenInvite } from "./invite-list";

export const metadata: Metadata = {
  title: "Convites",
};

/**
 * Invite someone to an organization, and follow the invites still open. Who may
 * invite whom is the database's rule (0031); the form only offers what the
 * rule allows, so a refusal is the exception and not the way to learn it.
 */
export default async function InvitesPage() {
  const { supabase, user, access } = await requireTeacher();

  const [organizations, { data: open, error: openError }] = await Promise.all([
    readInvitableOrganizations(supabase, user.id, access.platformAdmin),
    supabase
      .from("organization_invites")
      .select("id, email, role, expires_at, organization_id")
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);
  if (openError) throw new Error(openError.message);

  const nameOf = new Map(
    organizations.map((organization) => [organization.id, organization.name]),
  );
  // A teacher reads every invite of her organization but renews and cancels only
  // the student ones (can_invite in 0031); the others show no buttons.
  const rolesFor = new Map(
    organizations.map((organization) => [organization.id, organization.roles]),
  );
  const now = new Date();
  const invites: OpenInvite[] = open.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expires_at,
    expired: new Date(invite.expires_at) <= now,
    manageable: (rolesFor.get(invite.organization_id) ?? []).includes(
      invite.role,
    ),
    organizationName: nameOf.get(invite.organization_id) ?? null,
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

      {organizations.length === 0 ? (
        <p className="text-muted">Você não pode convidar ninguém.</p>
      ) : (
        <InviteForm organizations={organizations} />
      )}

      <InviteList
        invites={invites}
        showOrganization={organizations.length > 1}
      />
    </section>
  );
}

type Supabase = Awaited<ReturnType<typeof requireTeacher>>["supabase"];

/** The organizations this person may invite to, each with the roles she may give. */
async function readInvitableOrganizations(
  supabase: Supabase,
  userId: string,
  platformAdmin: boolean,
): Promise<InvitableOrganization[]> {
  if (platformAdmin) {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name")
      .order("name");
    if (error) throw new Error(error.message);
    return data.map((organization) => ({
      ...organization,
      roles: invitableRoles(true, []),
    }));
  }

  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(id, name)")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const byOrganization = new Map<
    string,
    { name: string; roles: OrganizationRole[] }
  >();
  for (const { role, organizations } of data) {
    const entry = byOrganization.get(organizations.id) ?? {
      name: organizations.name,
      roles: [],
    };
    entry.roles.push(role);
    byOrganization.set(organizations.id, entry);
  }

  return [...byOrganization]
    .map(([id, { name, roles }]) => ({
      id,
      name,
      roles: invitableRoles(false, roles),
    }))
    .filter((organization) => organization.roles.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
