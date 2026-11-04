import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Turns the emailed link into a session.
 *
 * Two shapes arrive here depending on how the project sends its mail: a PKCE
 * `code`, or a `token_hash` with the OTP `type`. Both are handled, because
 * which one shows up is a dashboard setting and not something this route should
 * care about.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;

  // Resolved once, here, and passed to redirect as-is. This is the one place a
  // stranger's URL reaches a redirect that fires the instant someone is signed
  // in, so it is checked before anything else happens. `origin` is only the
  // base it is checked against: outside Vercel it names the server's host,
  // not the one the link was opened at (#102).
  const next = safeNextPath(searchParams.get("next"), origin);

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return redirectTo(next);
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return redirectTo(next);
    }
  }

  // Expired, already used, or tampered with. All the same to the person holding
  // it: ask for a fresh one.
  return redirectTo("/login?error=link");
}

/**
 * A redirect with a relative Location, which the browser resolves against the
 * address it opened the link at, so the session cookie set here and the page
 * it goes to are on the same host. NextResponse.redirect only takes an
 * absolute URL, and the only absolute URL this route has is built on
 * nextUrl.origin, which is localhost when the link was opened at 127.0.0.1.
 *
 * The cookies the sign-in set through cookies() still go out: Next merges
 * them into whatever Response a route handler returns.
 *
 * Only ever given safeNextPath's result or a constant: a Location starting
 * with "//" would be another site, and safeNextPath is what refuses one.
 */
function redirectTo(location: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { location } });
}
