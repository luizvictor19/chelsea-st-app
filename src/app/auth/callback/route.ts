import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { safeNextUrl } from "@/lib/safe-redirect";
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
  // in, so it is checked before anything else happens.
  const next = safeNextUrl(searchParams.get("next"), origin);

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(next);
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(next);
    }
  }

  // Expired, already used, or tampered with. All the same to the person holding
  // it: ask for a fresh one.
  return NextResponse.redirect(new URL("/login?error=link", origin));
}
