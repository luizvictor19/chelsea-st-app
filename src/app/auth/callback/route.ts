import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * Only same-origin paths are allowed through the `next` parameter. Without this
 * a crafted link could carry someone straight from our domain to another one,
 * having just signed them in.
 */
function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/";
  }
  return raw;
}

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
  const next = safeNextPath(searchParams.get("next"));

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Expired, already used, or tampered with. All the same to the person holding
  // it: ask for a fresh one.
  return NextResponse.redirect(new URL("/login?error=link", origin));
}
