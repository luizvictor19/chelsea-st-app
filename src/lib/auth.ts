import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type Role = Database["public"]["Enums"]["user_role"];

export type Destination = "/login" | "/dashboard" | "/teacher";

/**
 * Where the current visitor belongs.
 *
 * The role is read from profiles on the server. A role decided in the browser
 * is a role the browser can lie about; RLS is the real defence and this is only
 * routing.
 *
 * A student with no row in `students` still lands on /dashboard, which is the
 * screen that explains the account is not released yet. Sending them somewhere
 * else would need a route the spec does not have.
 */
export async function resolveDestination(): Promise<Destination> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return "/login";
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return profile?.role === "teacher" ? "/teacher" : "/dashboard";
}
