import type { OrganizationRole } from "@/lib/access";
import { invitableRoles } from "@/lib/invites";
import type { createClient } from "@/lib/supabase/server";

import type { InvitableOrganization } from "./invite-form";
import type {
  OpenFounderInvite,
  OpenInvite,
  WaitingPersonalPlan,
} from "./invite-list";

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
      .select("id, name, has_teacher, open_signup")
      .order("name");
    if (error) throw new Error(error.message);
    return data.map(({ id, name, has_teacher, open_signup }) => ({
      id,
      name,
      hasTeacher: has_teacher,
      roles: invitableRoles(true, [], has_teacher, open_signup),
      manageRoles: invitableRoles(true, [], has_teacher),
    }));
  }

  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(id, name, has_teacher, open_signup)")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const byOrganization = new Map<
    string,
    {
      name: string;
      hasTeacher: boolean;
      openSignup: boolean;
      roles: OrganizationRole[];
    }
  >();
  for (const { role, organizations } of data) {
    const entry = byOrganization.get(organizations.id) ?? {
      name: organizations.name,
      hasTeacher: organizations.has_teacher,
      openSignup: organizations.open_signup,
      roles: [],
    };
    entry.roles.push(role);
    byOrganization.set(organizations.id, entry);
  }

  return [...byOrganization]
    .map(([id, { name, hasTeacher, openSignup, roles }]) => ({
      id,
      name,
      hasTeacher,
      roles: invitableRoles(false, roles, hasTeacher, openSignup),
      manageRoles: invitableRoles(false, roles, hasTeacher),
    }))
    .filter((organization) => organization.manageRoles.length > 0)
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
        manageable: organization.manageRoles.includes(invite.role),
        organizationName: organization.name,
        hasTeacher: organization.hasTeacher,
      },
    ];
  });
}

/**
 * The personal plans still waiting for their account, on sale (0058), for
 * the platform admin: plans_read_admin gives them to her alone.
 */
export async function readWaitingPersonalPlans(
  supabase: Client,
): Promise<WaitingPersonalPlan[]> {
  const { data, error } = await supabase
    .from("plans")
    .select("id, name, person_email")
    .eq("audience", "person")
    .eq("is_active", true)
    .is("person_id", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data.flatMap((plan) =>
    plan.person_email === null
      ? []
      : [{ id: plan.id, name: plan.name, email: plan.person_email }],
  );
}

/**
 * The founder invites still open (0059), for the platform admin:
 * founder_invites_read gives them to her alone. Each with the link of its
 * e-mail, to send by hand when the e-mail does not go.
 */
export async function readOpenFounderInvites(
  supabase: Client,
  now: Date,
  signupLink: (email: string) => string | null,
): Promise<OpenFounderInvite[]> {
  const { data, error } = await supabase
    .from("founder_invites")
    .select("id, email, expires_at")
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`founder_invites: ${error.message}`);
  return data.map((invite) => ({
    id: invite.id,
    email: invite.email,
    expiresAt: invite.expires_at,
    expired: new Date(invite.expires_at) <= now,
    link: signupLink(invite.email),
  }));
}
