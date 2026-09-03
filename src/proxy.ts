import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * Runs before every matched request. Named "proxy" because Next 16 deprecated
 * the "middleware" filename; the job is the one the spec describes, which is
 * keeping the session fresh and gating the private routes.
 */
export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except Next's own assets and the static files in /public. The
  // auth cookies need refreshing on real navigations, not on font requests.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)",
  ],
};
