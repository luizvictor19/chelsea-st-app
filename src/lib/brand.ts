import type { Metadata } from "next";

/*
 * Which brand a request is served under, chosen by its Host (#194).
 *
 * Pure on purpose: node:test runs this file as plain TypeScript, so it imports
 * nothing but types. Reading the header is src/lib/current-site.ts.
 *
 * The list of sites lives in code until #195, which replaces it with rows of
 * `organizations` of the same shape: whoever consumes a Site does not change.
 */

/** One icon file under public/, with the size it really has. */
export type BrandIcon = {
  readonly url: string;
  readonly sizes: string;
};

/** What a brand shows. Data only, so #195 can read it from a row. */
export type Brand = {
  readonly name: string;
  readonly description: string;
  readonly icons: {
    readonly icon: BrandIcon;
    readonly apple: BrandIcon;
  } | null;
  /** The "Dúvidas" address on the screen of an account with no access. */
  readonly contactEmail: string | null;
};

/**
 * A host this platform answers as itself. The origin comes from the list,
 * never from the text of the Host header: #196 builds email links on it, and a
 * forged Host must not become a link.
 */
export type Site = {
  readonly host: string;
  readonly origin: string;
  readonly brand: Brand;
};

export const CHELSEA: Brand = {
  name: "Chelsea St",
  description: "Plataforma de apoio às aulas de inglês da Chelsea St.",
  // Moved out of src/app (#194): the file convention there overrides
  // generateMetadata, so every host got these. Sizes are checked against the
  // files by brand.test.ts.
  icons: {
    icon: { url: "/brand/chelsea/icon.png", sizes: "512x512" },
    apple: { url: "/brand/chelsea/apple-icon.png", sizes: "180x180" },
  },
  contactEmail: null,
};

/** No icon until the griffin artwork (#195), no contact until its row does. */
export const GRIFOAI: Brand = {
  name: "GrifoAI",
  description: "Plataforma de apoio às aulas de inglês da GrifoAI.",
  icons: null,
  contactEmail: null,
};

const CHELSEA_HOST = "app.chelsea-st.com";

export type SiteConfig = {
  readonly sites: readonly Site[];
  /** Off Vercel only: localhost and 127.0.0.1, on any port, are this brand. */
  readonly loopback: Brand | null;
};

/**
 * A Host as a browser sends it: a name of letters, digits, dots and hyphens,
 * and a port when there is one. Anything else (a space, an "@", a path, an
 * empty port) is no host of ours.
 */
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/;
const LOOPBACK = /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function sitesFromEnv(env: {
  readonly GRIFOAI_HOST?: string;
  readonly VERCEL?: string;
  readonly contactEmail?: string;
}): SiteConfig {
  const chelsea: Brand = {
    ...CHELSEA,
    contactEmail: env.contactEmail || null,
  };
  const sites: Site[] = [
    { host: CHELSEA_HOST, origin: `https://${CHELSEA_HOST}`, brand: chelsea },
  ];

  const grifoHost = (env.GRIFOAI_HOST ?? "").trim().toLowerCase();
  if (HOST.test(grifoHost)) {
    const name = grifoHost.replace(/:\d+$/, "");
    const scheme = name.endsWith(".localhost") ? "http" : "https";
    sites.push({
      host: grifoHost,
      origin: `${scheme}://${grifoHost}`,
      brand: GRIFOAI,
    });
  }

  // On Vercel no legitimate request arrives as localhost, and #196 will build
  // email links on this origin.
  return { sites, loopback: env.VERCEL ? null : chelsea };
}

/**
 * The site a Host belongs to, or null for any host outside the list: a
 * preview, the .vercel.app alias of production, anything else. Null is the
 * neutral brand, never Chelsea.
 *
 * Compared whole and exact, port included: "app.chelsea-st.com:443" and
 * "app.chelsea-st.com.evil.com" are not ours.
 */
export function resolveSite(
  host: string | null,
  config: SiteConfig,
): Site | null {
  if (host === null) {
    return null;
  }
  const wanted = host.toLowerCase();
  if (!HOST.test(wanted)) {
    return null;
  }

  const listed = config.sites.find((site) => site.host === wanted);
  if (listed) {
    return listed;
  }

  if (config.loopback && LOOPBACK.test(wanted)) {
    return {
      host: wanted,
      origin: `http://${wanted}`,
      brand: config.loopback,
    };
  }
  return null;
}

/** The root layout's metadata: brand name in every title, or no brand at all. */
export function rootMetadata(site: Site | null): Metadata {
  if (!site) {
    // No title template: each page's own name stands alone. Kept out of
    // search engines, since nothing here says whose page it is.
    return { robots: { index: false, follow: false } };
  }

  const { brand } = site;
  return {
    title: { default: brand.name, template: `%s · ${brand.name}` },
    description: brand.description,
    ...(brand.icons
      ? {
          icons: {
            icon: [{ ...brand.icons.icon, type: "image/png" }],
            apple: [{ ...brand.icons.apple, type: "image/png" }],
          },
        }
      : {}),
  };
}

/** A page's own name, and its canonical on the site's origin when given a path. */
export function pageMetadata(
  site: Site | null,
  title: string,
  path?: string,
): Metadata {
  if (!site || path === undefined) {
    return { title };
  }
  return {
    title,
    alternates: { canonical: new URL(path, site.origin).href },
  };
}
