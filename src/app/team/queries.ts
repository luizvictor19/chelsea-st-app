import type { createClient } from "@/lib/supabase/server";
import {
  TEAM_WEEKS,
  type TeamMember,
  type TeamPractice,
  type TeamProfile,
} from "@/lib/team";

type Client = Awaited<ReturnType<typeof createClient>>;

export type TeamData = {
  readonly members: readonly TeamMember[];
  readonly profiles: readonly TeamProfile[];
  readonly practice: readonly TeamPractice[];
};

/**
 * Who joined the organizations given (members with the role student), their
 * names and zones, and their practice through team_practice (0044), the only
 * door to it: one call per organization. The viewer's profile comes too, for
 * the zone of the week labels. A read that fails throws, to the error screen:
 * a team read as empty would tell the admin nobody joined.
 */
export async function readTeam(
  supabase: Client,
  organizationIds: readonly string[],
  viewerId: string,
): Promise<TeamData> {
  if (organizationIds.length === 0) {
    return { members: [], profiles: [], practice: [] };
  }

  const [membersRead, ...practiceReads] = await Promise.all([
    supabase
      .from("organization_members")
      .select("user_id, organization_id, created_at")
      .eq("role", "student")
      .in("organization_id", [...organizationIds]),
    ...organizationIds.map((id) =>
      supabase.rpc("team_practice", {
        p_organization: id,
        p_weeks: TEAM_WEEKS,
      }),
    ),
  ]);
  if (membersRead.error) throw new Error(membersRead.error.message);

  const practice = practiceReads.flatMap((read, index) => {
    if (read.error) throw new Error(read.error.message);
    return read.data.map((row) => ({
      organizationId: organizationIds[index],
      personId: row.person_id,
      // The generated type says string; the column is null for whoever never
      // practised.
      lastPractisedOn: (row.last_practised_on as string | null) ?? null,
      daysByWeek: row.days_by_week,
      minutesThisMonth: row.minutes_this_month,
    }));
  });

  const ids = [
    ...new Set([viewerId, ...membersRead.data.map((m) => m.user_id)]),
  ];
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, full_name, timezone")
    .in("id", ids);
  if (error) throw new Error(error.message);

  return {
    members: membersRead.data.map((m) => ({
      userId: m.user_id,
      organizationId: m.organization_id,
      joinedAt: m.created_at,
    })),
    profiles: profiles.map((p) => ({
      id: p.id,
      fullName: p.full_name,
      timeZone: p.timezone,
    })),
    practice,
  };
}
