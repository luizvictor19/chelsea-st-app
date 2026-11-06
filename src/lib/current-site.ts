import { headers } from "next/headers";
import { cache } from "react";

import { resolveSite, sitesFromEnv, type Site } from "@/lib/brand";
import { env } from "@/lib/env";

/**
 * The site of this request, by its Host, or null for a host outside the list
 * (the neutral brand). Read once per request: the layout, the page metadata
 * and the brand mark all ask.
 *
 * Reading the header makes the route dynamic, which is what lets the brand
 * differ per host.
 */
export const currentSite = cache(async (): Promise<Site | null> => {
  const config = sitesFromEnv({
    GRIFOAI_HOST: process.env.GRIFOAI_HOST,
    VERCEL: process.env.VERCEL,
    contactEmail: env.NEXT_PUBLIC_TEACHER_CONTACT_EMAIL,
  });
  return resolveSite((await headers()).get("host"), config);
});
