import { destinationFor, type Access } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

export type Destination = "/login" | "/dashboard" | "/teacher";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The current person's roles, read on the server from school_members and
 * platform_admins (0029). A role decided in the browser is a role the browser
 * can lie about; RLS is the real defence and this is only routing.
 *
 * A read that fails counts as no role, which lands on the screen that says
 * the account is not released yet: never on a screen the person may not use.
 */
export async function readAccess(
  supabase: Client,
  userId: string,
): Promise<Access> {
  const [{ data: members }, { data: admin }] = await Promise.all([
    supabase.from("school_members").select("role").eq("user_id", userId),
    supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return {
    platformAdmin: admin !== null,
    roles: (members ?? []).map((member) => member.role),
  };
}

/**
 * Where the current visitor belongs.
 *
 * Someone with no role still lands on /dashboard, which is the screen that
 * explains the account is not released yet. Sending them somewhere else would
 * need a route the spec does not have.
 */
export async function resolveDestination(): Promise<Destination> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return "/login";
  }

  return destinationFor(await readAccess(supabase, user.id));
}
