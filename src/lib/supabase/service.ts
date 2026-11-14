/**
 * The client with the service role key, for the server code that calls the
 * functions only service_role executes: billing and credits (#72, #273), the
 * calendar invites (#294), the proposal e-mails (#319) and the error log
 * (#69, app_error_record), and the routine reading a person's e-mail from
 * auth. It passes every policy: never use it to read or write a table.
 */

import { createClient } from "@supabase/supabase-js";

import { env, serviceRoleKey } from "../env.ts";

import type { Database } from "./types.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "supabase/service.ts is server only and must not reach the browser",
  );
}

export function createServiceClient() {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey(),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
