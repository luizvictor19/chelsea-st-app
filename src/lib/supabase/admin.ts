import { createClient } from "@supabase/supabase-js";

import { env, serviceRoleKey } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

// This module holds the key that passes every policy, so it must never be
// bundled for the browser. There is no server-only package here, so the guard
// is explicit.
if (typeof window !== "undefined") {
  throw new Error(
    "supabase/admin.ts is server only and must not reach the browser",
  );
}

/**
 * The client that sends invite emails, and does nothing else.
 *
 * Only Supabase's own invite endpoint needs it: the invite row is written
 * before, with the inviter's own client, so RLS has already decided whether
 * this person may invite. Never use it to read or write tables.
 */
export function createInviteMailer() {
  const client = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return client.auth.admin;
}
