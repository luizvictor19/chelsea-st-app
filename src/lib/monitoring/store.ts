/**
 * app_error_record of 0061, called with the service role (#69). Server only:
 * the client holds the key that passes every policy, and this file names no
 * table, only the function.
 */

import { createServiceClient } from "../supabase/service.ts";

import { RecordRefused, type CleanError, type Recorded } from "./report.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "monitoring/store.ts is server only and must not reach the browser",
  );
}

export async function recordAppError(error: CleanError): Promise<Recorded> {
  const { data, error: failure } = await createServiceClient().rpc(
    "app_error_record",
    {
      p_fingerprint: error.fingerprint,
      p_kind: error.kind,
      p_route: error.route,
      p_message: error.message,
      // The generator marks every argument as text; null is what the
      // function takes for a missing one.
      p_stack: error.stack as string,
      p_digest: error.digest as string,
      p_release: error.release as string,
    },
  );
  if (failure) {
    // The code alone: the message of a refusal can repeat what was sent. A
    // data exception (22) or a constraint (23) is the row refused, not the
    // database down.
    const code = failure.code || "no code";
    if (/^2[23]/.test(code)) throw new RecordRefused(code);
    throw new Error(`app_error_record failed: ${code}`);
  }
  const row = data[0];
  if (row === undefined) throw new Error("app_error_record answered no row");
  return {
    alert: row.alert,
    day: row.day,
    count: row.count,
    firstAt: row.first_at,
    overflow: row.overflow,
  };
}
