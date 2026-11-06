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

type OpenInviteRow = {
  readonly id: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly expires_at: string;
  readonly organization_id: string;
};

/**
 * Every invite still open that this person reads (organization_invites_read:
 * the organizations where she is admin or teacher, or all of them for a
 * platform admin). Read beside the organizations, not after them, so a
 * screen pays one round trip for both; openInvites keeps the ones it shows.
 */
export async function readOpenInvites(
  supabase: Client,
): Promise<OpenInviteRow[]> {
  const { data, error } = await supabase
    .from("organization_invites")
    .select("id, email, role, expires_at, organization_id")
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * The open invites of the organizations given, as the list shows them. A
 * teacher reads every invite of her organization but renews and cancels only
 * the student ones (can_invite in 0031); the others show no buttons.
 */
export function openInvites(
  rows: readonly OpenInviteRow[],
  organizations: readonly InvitableOrganization[],
  now: Date,
): OpenInvite[] {
  const byId = new Map(
    organizations.map((organization) => [organization.id, organization]),
  );
  return rows.flatMap((invite) => {
    const organization = byId.get(invite.organization_id);
    if (!organization) return [];
    return [
      {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expires_at,
        expired: new Date(invite.expires_at) <= now,
        manageable: organization.roles.includes(invite.role),
        organizationName: organization.name,
        hasTeacher: organization.hasTeacher,
      },
    ];
  });
}
