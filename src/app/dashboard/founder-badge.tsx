import Link from "next/link";

import { BADGE_LABEL } from "@/lib/badges";
import { createClient } from "@/lib/supabase/server";

/**
 * The small "Fundador" seal under her name (#292), for whoever holds a live
 * Founder seal; it leads to /dashboard/plano, where the line explains it.
 * No number. A read that fails shows nothing.
 */
export async function FounderBadge() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("holds_badge", { p_badge: "founder" });
  if (data !== true) return null;
  return (
    <Link
      href="/dashboard/plano"
      className="border-accent text-accent self-start rounded-full border px-3 py-1 font-mono text-xs tracking-[0.12em] uppercase"
    >
      {BADGE_LABEL.founder}
    </Link>
  );
}
