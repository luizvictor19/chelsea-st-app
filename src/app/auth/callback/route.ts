import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { safeNextPath, sameHostRedirect } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Turns the emailed link into a session.
 *
 * Two shapes arrive here depending on how the project sends its mail: a PKCE
 * `code`, or a `token_hash` with the OTP `type`. Both are handled, because
 * which one shows up is a dashboard setting and not something this route should
 * care about.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams, origin } = request.nextUrl;

  // Resolved once, here, before anything else happens. This is the one place
  // a stranger's URL reaches a redirect that fires the instant someone is
  // signed in. Two checks make it safe, both in safeNextPath: the destination
  // resolves onto `origin`, and the path it returns cannot be read as another
  // host. `origin` is only the base of the first: outside Vercel it names the
  // server's host, not the one the link was opened at (#102).
  const next = safeNextPath(searchParams.get("next"), origin);

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return sameHostRedirect(next, 307);
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return sameHostRedirect(next, 307);
    }
  }

  // Expired, already used, or tampered with. All the same to the person holding
  // it: ask for a fresh one.
  return sameHostRedirect("/login?error=link", 307);
}
