import { cookies } from "next/headers";

import { sameHostRedirect } from "@/lib/safe-redirect";
import { sessionCookieNames } from "@/lib/session-cookies";
import { createClient } from "@/lib/supabase/server";

/**
 * Ends the session on this device and sends the person to /login.
 *
 * A route handler reached by a plain form POST, not a server action: it sits
 * outside the protected routes, so a session that already expired cannot get
 * the request turned away by the proxy, and the browser navigates for real,
 * which lets a screen with unsaved work ask before leaving (beforeunload).
 *
 * Local scope, not the default global one: leaving the organization's computer should
 * not sign the same person out of her phone. When the auth server cannot be
 * reached, the session cookies are deleted here anyway: on a shared computer,
 * "Sair da conta" must leave this browser signed out.
 */
export async function POST(): Promise<Response> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });

  if (error) {
    const cookieStore = await cookies();
    const names = cookieStore.getAll().map(({ name }) => name);
    for (const name of sessionCookieNames(names)) {
      cookieStore.delete(name);
    }
  }

  // 303, so the browser follows with a GET. Relative, so 127.0.0.1 stays
  // 127.0.0.1 outside Vercel (#172), as the auth callback does since #102.
  return sameHostRedirect("/login", 303);
}
