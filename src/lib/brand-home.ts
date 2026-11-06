import type { BrandKey, Site, SiteConfig } from "./brand.ts";

/*
 * Where the front door sends someone who signed in under a brand her
 * organizations do not wear (#195). The Host decides what every screen looks
 * like; the organization decides where the person goes, so a GrifoAI employee
 * who types the Chelsea domain is taken to GrifoAI's.
 *
 * Pure on purpose: node:test runs this file as plain TypeScript. Reading the
 * memberships is readMemberBrands() in src/lib/auth.ts, for
 * resolveDestination().
 */

export type HomeInput = {
  /** The site of this request, or null for a host outside the list. */
  readonly here: Site | null;
  readonly platformAdmin: boolean;
  /** The brand of each organization she belongs to, repeats allowed. */
  readonly memberBrands: readonly BrandKey[];
  readonly config: SiteConfig;
};

/**
 * The site to send her to, or null to stay.
 *
 * She stays when she is a platform admin (above every brand), when she
 * belongs to no organization (the screen of an account not released yet is
 * on any host), when one of her organizations wears the brand of this host,
 * and on a host outside the list (a preview, where she came on purpose).
 *
 * She also stays when the other brand has no site of the same scheme: no
 * GrifoAI domain yet (#193), or a dev server, whose http never sends anyone to
 * production's https and back. A redirect to a host that does not exist would
 * lock her out.
 */
export function homeSite({
  here,
  platformAdmin,
  memberBrands,
  config,
}: HomeInput): Site | null {
  if (platformAdmin || here === null || memberBrands.length === 0) {
    return null;
  }
  if (memberBrands.includes(here.brand.key)) {
    return null;
  }

  const scheme = new URL(here.origin).protocol;
  for (const brand of new Set(memberBrands)) {
    const there = config.sites.find(
      (site) =>
        site.brand.key === brand && new URL(site.origin).protocol === scheme,
    );
    if (there) {
      return there;
    }
  }
  return null;
}
