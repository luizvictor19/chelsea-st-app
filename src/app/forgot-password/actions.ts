"use server";

import { after } from "next/server";

import { recoveryOptions } from "@/lib/auth-links";
import { normalizeEmail } from "@/lib/credentials";
import { currentSite } from "@/lib/current-site";
import { requestLink } from "@/lib/link-request";
import { createClient } from "@/lib/supabase/server";

export type ResetState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

/**
 * Sends the link that leads to /set-password.
 *
 * Same answer for an address with an account and one without, at once, and
 * the email goes out after the response, for the reason the login gives
 * (src/lib/link-request.ts, #110). The redirect is only the origin of this
 * request's site (src/lib/auth-links.ts): the reset template adds the path,
 * /set-password included (docs/commands.md).
 */
export async function sendPasswordReset(
  _previous: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const email = normalizeEmail(formData.get("email"));
  const site = await currentSite();
  const supabase = await createClient();

  return requestLink({
    email,
    flow: "recovery",
    send: async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email,
        recoveryOptions(site),
      );
      return error;
    },
    schedule: after,
    log: console,
  });
}
