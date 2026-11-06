import type { OrganizationRole } from "@/lib/access";
import { invitableRoles } from "@/lib/invites";
import type { createClient } from "@/lib/supabase/server";

import type { InvitableOrganization } from "./invite-form";
import type { OpenInvite } from "./invite-list";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The organizations this person may invite to, each with the roles she may
 * give and whether it has a teacher (0042). Shared by /teacher/invites and
 * /team.
 */
export async function readInvitableOrganizations(
  supabase: Client,
  userId: string,
  platformAdmin: boolean,
): Promise<InvitableOrganization[]> {
  if (platformAdmin) {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, has_teacher")
      .order("name");
    if (error) throw new Error(error.message);
    return data.map(({ id, name, has_teacher }) => ({
      id,
      name,
      hasTeacher: has_teacher,
      roles: invitableRoles(true, [], has_teacher),
    }));
  }

  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(id, name, has_teacher)")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const byOrganization = new Map<
    string,
    { name: string; hasTeacher: boolean; roles: OrganizationRole[] }
  >();
  for (const { role, organizations } of data) {
    const entry = byOrganization.get(organizations.id) ?? {
      name: organizations.name,
      hasTeacher: organizations.has_teacher,
      roles: [],
    };
    entry.roles.push(role);
    byOrganization.set(organizations.id, entry);
  }

  return [...byOrganization]
    .map(([id, { name, hasTeacher, roles }]) => ({
      id,
      name,
      hasTeacher,
      roles: invitableRoles(false, roles, hasTeacher),
    }))
    .filter((organization) => organization.roles.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * The invites still open that this person reads (organization_invites_read),
 * of the organizations given. A teacher reads every invite of her
 * organization but renews and cancels only the student ones (can_invite in
 * 0031); the others show no buttons.
 */
export async function readOpenInvites(
  supabase: Client,
  organizations: readonly InvitableOrganization[],
): Promise<OpenInvite[]> {
  const { data, error } = await supabase
    .from("organization_invites")
    .select("id, email, role, expires_at, organization_id")
    .in(
      "organization_id",
      organizations.map((organization) => organization.id),
    )
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const byId = new Map(
    organizations.map((organization) => [organization.id, organization]),
  );
  const now = new Date();
  return data.map((invite) => {
    const organization = byId.get(invite.organization_id);
    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expires_at,
      expired: new Date(invite.expires_at) <= now,
      manageable: (organization?.roles ?? []).includes(invite.role),
      organizationName: organization?.name ?? null,
      hasTeacher: organization?.hasTeacher ?? true,
    };
  });
}
