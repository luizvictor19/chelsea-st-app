import type { Metadata } from "next";

/*
 * Which brand a request is served under, chosen by its Host (#194).
 *
 * Pure on purpose: node:test runs this file as plain TypeScript, so it imports
 * nothing but types. Reading the header is src/lib/current-site.ts.
 *
 * What a brand looks like lives here, in code, reviewed in a PR: its name,
 * icons, mascot and host. The database says only which brand each
 * organization wears, organizations.brand (0041, #195), as one of BRAND_KEYS.
 */

/**
 * The brands an organization can wear. The same list as the check
 * organizations_brand_known (0041); src/lib/brand-keys.test.ts holds the two
 * equal, so a brand added on one side alone breaks the gate.
 */
export const BRAND_KEYS = ["chelsea-st", "grifoai"] as const;

export type BrandKey = (typeof BRAND_KEYS)[number];

/** A value read from organizations.brand, narrowed to a key this code knows. */
export function isBrandKey(value: unknown): value is BrandKey {
  return (BRAND_KEYS as readonly unknown[]).includes(value);
}

/**
 * Where a brand's mascot art lives under public/: the folder and the prefix of
 * each file. The files themselves are named in
 * src/app/teacher/session-preview/mascot-art.ts, and mascot-files.test.ts
 * holds that every one of them exists for every brand.
 */
export type Mascot = {
  readonly dir: "/robin" | "/grifo";
  readonly prefix: "robin" | "grifo";
};

/** One icon file under public/, with the size it really has. */
export type BrandIcon = {
  readonly url: string;
  readonly sizes: string;
};

/** What a brand shows. */
export type Brand = {
  /** The value of organizations.brand for an organization wearing it. */
  readonly key: BrandKey;
  readonly name: string;
  readonly description: string;
  readonly icons: {
    readonly icon: BrandIcon;
    readonly apple: BrandIcon;
  } | null;
  /** The "Dúvidas" address on the screen of an account with no access. */
  readonly contactEmail: string | null;
  /** The art of the tutor. The tutor is called Robin under both brands. */
  readonly mascot: Mascot;
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
  key: "chelsea-st",
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
  mascot: { dir: "/robin", prefix: "robin" },
};

/**
 * No icon until the griffin artwork arrives, and no contact until GrifoAI has
 * an address of its own.
 *
 * The mascot is Robin's art as a stand-in: the griffin's files are not in the
 * repository yet. When they arrive in public/grifo/, this becomes
 * { dir: "/grifo", prefix: "grifo" } and mascot-files.test.ts checks every
 * file is there.
 */
export const GRIFOAI: Brand = {
  key: "grifoai",
  name: "GrifoAI",
  description:
    "Treino de inglês com IA para as equipes das empresas, da GrifoAI.",
  icons: null,
  contactEmail: null,
  mascot: { dir: "/robin", prefix: "robin" },
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

/**
 * The listed site of a brand, or null when it has none (GrifoAI before
 * GRIFOAI_HOST is set). Loopback is never returned: it is a dev server's
 * address, not where a brand lives.
 */
export function siteOfBrand(key: BrandKey, config: SiteConfig): Site | null {
  return config.sites.find((site) => site.brand.key === key) ?? null;
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
