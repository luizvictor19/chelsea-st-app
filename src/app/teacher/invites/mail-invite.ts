import { inviteOptions } from "@/lib/auth-links";
import { isBrandKey, siteOfBrand } from "@/lib/brand";
import { currentSite, siteConfig } from "@/lib/current-site";
import { mailProblem } from "@/lib/invites";
import { createInviteMailer } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Asks Supabase to mail the invite. For a new email it creates the account,
 * unconfirmed: the membership waits for the click (0031), and the link leads
 * to /set-password through the invite template of docs/commands.md. For an
 * account that already exists it mails nothing, and that reads as sent: she
 * accepts when she signs in (0032). See mailProblem.
 *
 * The link leads to the site of the brand the organization wears (#195),
 * read here so every caller gets it: a GrifoAI company's invite opens on the
 * GrifoAI domain, whoever sent it and from wherever. A brand with no site yet
 * (no GrifoAI domain before #193) gets no redirect, so the Site URL. When the
 * organization's brand cannot be read, the inviter's site, as before #195.
 *
 * Kept out of the "use server" files that call it (the invite actions and
 * the creation of a company, #205): exported from one of them, it would be a
 * public endpoint.
 */
export async function mailInvite(
  supabase: Client,
  email: string,
  organizationId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("organizations")
    .select("brand")
    .eq("id", organizationId)
    .maybeSingle();
  const site = isBrandKey(data?.brand)
    ? siteOfBrand(data.brand, siteConfig())
    : await currentSite();

  const { error } = await createInviteMailer().inviteUserByEmail(
    email,
    inviteOptions(site),
  );
  return mailProblem(error);
}
