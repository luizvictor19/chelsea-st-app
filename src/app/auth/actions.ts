"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Ends the session on this device and sends the person to /login.
 *
 * Local scope, not the default global one: leaving the school's computer should
 * not sign the same person out of her phone. The session cookies are written by
 * the server client, so the server is where they are cleared.
 *
 * A failed call still redirects. The cookies then survive, and the next request
 * decides by what the auth server says: at worst she is still signed in and
 * presses Sair again.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
