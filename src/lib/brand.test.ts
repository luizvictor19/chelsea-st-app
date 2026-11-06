import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";

import {
  BRAND_KEYS,
  BRANDS,
  CHELSEA,
  GRIFOAI,
  isBrandKey,
  pageMetadata,
  resolveSite,
  rootMetadata,
  siteOfBrand,
  sitesFromEnv,
  type SiteConfig,
} from "./brand.ts";

const CONTACT = "contato@chelsea.example";

/** Production as it is today: no GrifoAI domain yet (#193), on Vercel. */
const PRODUCTION = sitesFromEnv({
  VERCEL: "1",
  contactEmail: CONTACT,
});

/** A dev server, where loopback is Chelsea. */
const LOCAL = sitesFromEnv({ contactEmail: CONTACT });

function site(host: string | null, config: SiteConfig) {
  return resolveSite(host, config);
}

describe("resolveSite, the Chelsea domain", () => {
  test("app.chelsea-st.com is Chelsea, on its https origin", () => {
    const found = site("app.chelsea-st.com", PRODUCTION);
    assert.equal(found?.brand.name, "Chelsea St");
    assert.equal(found?.origin, "https://app.chelsea-st.com");
    assert.equal(found?.host, "app.chelsea-st.com");
  });

  test("the Host is compared in lower case", () => {
    const found = site("APP.CHELSEA-ST.COM", PRODUCTION);
    assert.equal(found?.brand.name, "Chelsea St");
    assert.equal(found?.origin, "https://app.chelsea-st.com");
  });

  test("Chelsea carries the contact from the environment", () => {
    assert.equal(
      site("app.chelsea-st.com", PRODUCTION)?.brand.contactEmail,
      CONTACT,
    );
  });

  test("an empty contact is no contact, not an empty address", () => {
    const config = sitesFromEnv({ VERCEL: "1", contactEmail: "" });
    assert.equal(site("app.chelsea-st.com", config)?.brand.contactEmail, null);
  });
});

describe("resolveSite, the GrifoAI domain", () => {
  test("GRIFOAI_HOST names the GrifoAI host, on https", () => {
    const config = sitesFromEnv({
      VERCEL: "1",
      GRIFOAI_HOST: "app.grifo.example",
      contactEmail: CONTACT,
    });
    const found = site("app.grifo.example", config);
    assert.equal(found?.brand.name, "GrifoAI");
    assert.equal(found?.origin, "https://app.grifo.example");
  });

  test("a .localhost GrifoAI host is served on http", () => {
    const config = sitesFromEnv({ GRIFOAI_HOST: "grifoai.localhost:3100" });
    const found = site("grifoai.localhost:3100", config);
    assert.equal(found?.brand.name, "GrifoAI");
    assert.equal(found?.origin, "http://grifoai.localhost:3100");
  });

  test("GRIFOAI_HOST is read in lower case and trimmed", () => {
    const config = sitesFromEnv({ GRIFOAI_HOST: " App.Grifo.Example " });
    assert.equal(site("app.grifo.example", config)?.brand.name, "GrifoAI");
  });

  test("GrifoAI shows no contact", () => {
    const config = sitesFromEnv({
      GRIFOAI_HOST: "app.grifo.example",
      contactEmail: CONTACT,
    });
    assert.equal(site("app.grifo.example", config)?.brand.contactEmail, null);
  });

  test("with GRIFOAI_HOST empty, that host is unknown", () => {
    for (const GRIFOAI_HOST of [undefined, "", "   "]) {
      const config = sitesFromEnv({ VERCEL: "1", GRIFOAI_HOST });
      assert.equal(site("app.grifo.example", config), null);
      assert.equal(site("", config), null);
    }
  });

  test("a GRIFOAI_HOST that is not a host enables nothing", () => {
    const config = sitesFromEnv({ GRIFOAI_HOST: "https://app.grifo.example" });
    assert.equal(site("app.grifo.example", config), null);
    assert.equal(site("https://app.grifo.example", config), null);
  });

  test("GRIFOAI_HOST cannot take the Chelsea domain over", () => {
    const config = sitesFromEnv({
      VERCEL: "1",
      GRIFOAI_HOST: "app.chelsea-st.com",
    });
    assert.equal(site("app.chelsea-st.com", config)?.brand.name, "Chelsea St");
  });
});

describe("resolveSite, loopback", () => {
  test("off Vercel, localhost and 127.0.0.1 are Chelsea on http, with the port", () => {
    assert.equal(
      site("localhost:3100", LOCAL)?.origin,
      "http://localhost:3100",
    );
    assert.equal(site("localhost:3100", LOCAL)?.brand.name, "Chelsea St");
    assert.equal(
      site("127.0.0.1:3110", LOCAL)?.origin,
      "http://127.0.0.1:3110",
    );
    assert.equal(site("127.0.0.1:3110", LOCAL)?.brand.contactEmail, CONTACT);
    assert.equal(site("localhost", LOCAL)?.origin, "http://localhost");
  });

  test("on Vercel, loopback is unknown", () => {
    assert.equal(site("localhost:3100", PRODUCTION), null);
    assert.equal(site("127.0.0.1:3110", PRODUCTION), null);
  });

  test("a loopback look-alike is unknown, also off Vercel", () => {
    for (const host of [
      "localhost.evil.com",
      "127.0.0.1.evil.com",
      "evil.localhost:3100",
      "localhost:",
      "localhost:abc",
      "localhost:123456",
    ]) {
      assert.equal(site(host, LOCAL), null, host);
    }
  });
});

describe("resolveSite, unknown hosts", () => {
  const UNKNOWN = [
    "evil.com",
    "app.chelsea-st.com.evil.com",
    "app.chelsea-st.com:443",
    "chelsea-st.com",
    "chelsea-st-app.vercel.app",
    "chelsea-st-app-git-feat-194-x.vercel.app",
    "",
    " app.chelsea-st.com",
    "app.chelsea-st.com ",
    "app chelsea-st.com",
    "user@app.chelsea-st.com",
    "app.chelsea-st.com@evil.com",
    "app.chelsea-st.com/path",
  ];

  for (const config of [PRODUCTION, LOCAL]) {
    test(`are null (${config === PRODUCTION ? "Vercel" : "local"})`, () => {
      for (const host of UNKNOWN) {
        assert.equal(site(host, config), null, JSON.stringify(host));
      }
      assert.equal(site(null, config), null);
    });
  }
});

describe("brand keys", () => {
  test("each brand carries its own key, and the keys are the list", () => {
    assert.deepEqual(Object.keys(BRANDS), [...BRAND_KEYS]);
    for (const [key, brand] of Object.entries(BRANDS)) {
      assert.equal(brand.key, key);
    }
    assert.equal(BRANDS["chelsea-st"], CHELSEA);
    assert.equal(BRANDS.grifoai, GRIFOAI);
  });

  test("isBrandKey takes the two keys and nothing else", () => {
    assert.ok(isBrandKey("chelsea-st"));
    assert.ok(isBrandKey("grifoai"));
    for (const value of ["", "Chelsea-St", "outra", null, undefined, 1]) {
      assert.equal(isBrandKey(value), false, String(value));
    }
  });
});

describe("siteOfBrand", () => {
  test("Chelsea lives on its https origin, on Vercel and off it", () => {
    for (const config of [PRODUCTION, LOCAL]) {
      assert.equal(
        siteOfBrand("chelsea-st", config)?.origin,
        "https://app.chelsea-st.com",
      );
    }
  });

  test("GrifoAI lives on GRIFOAI_HOST, and nowhere without it", () => {
    const config = sitesFromEnv({
      VERCEL: "1",
      GRIFOAI_HOST: "app.grifo.example",
    });
    assert.equal(
      siteOfBrand("grifoai", config)?.origin,
      "https://app.grifo.example",
    );
    assert.equal(siteOfBrand("grifoai", PRODUCTION), null);
    assert.equal(siteOfBrand("grifoai", LOCAL), null);
  });
});

describe("rootMetadata", () => {
  test("Chelsea gives exactly the metadata of today", () => {
    assert.deepEqual(rootMetadata(site("app.chelsea-st.com", PRODUCTION)), {
      title: { default: "Chelsea St", template: "%s · Chelsea St" },
      description: "Plataforma de apoio às aulas de inglês da Chelsea St.",
      icons: {
        icon: [
          {
            url: "/brand/chelsea/icon.png",
            type: "image/png",
            sizes: "512x512",
          },
        ],
        apple: [
          {
            url: "/brand/chelsea/apple-icon.png",
            type: "image/png",
            sizes: "180x180",
          },
        ],
      },
    });
  });

  test("GrifoAI gives its own name, its description and no icon", () => {
    const config = sitesFromEnv({ GRIFOAI_HOST: "app.grifo.example" });
    const metadata = rootMetadata(site("app.grifo.example", config));
    assert.deepEqual(metadata.title, {
      default: "GrifoAI",
      template: "%s · GrifoAI",
    });
    assert.equal(metadata.description, GRIFOAI.description);
    assert.equal(metadata.icons, undefined);
    assert.equal(metadata.robots, undefined);
    assert.doesNotMatch(JSON.stringify(metadata), /chelsea/i);
  });

  test("an unknown host is noindex, nofollow, with no brand at all", () => {
    const metadata = rootMetadata(null);
    assert.deepEqual(metadata, { robots: { index: false, follow: false } });
    assert.doesNotMatch(JSON.stringify(metadata), /chelsea/i);
  });
});

describe("pageMetadata", () => {
  test("a known site gets the title and an absolute canonical on its origin", () => {
    assert.deepEqual(
      pageMetadata(site("app.chelsea-st.com", PRODUCTION), "Entrar", "/login"),
      {
        title: "Entrar",
        alternates: { canonical: "https://app.chelsea-st.com/login" },
      },
    );
    assert.deepEqual(
      pageMetadata(site("127.0.0.1:3110", LOCAL), "Entrar", "/login"),
      {
        title: "Entrar",
        alternates: { canonical: "http://127.0.0.1:3110/login" },
      },
    );
  });

  test("without a path, only the title", () => {
    assert.deepEqual(
      pageMetadata(site("app.chelsea-st.com", PRODUCTION), "Entrar"),
      { title: "Entrar" },
    );
  });

  test("an unknown host gets no canonical", () => {
    assert.deepEqual(pageMetadata(null, "Entrar", "/login"), {
      title: "Entrar",
    });
  });
});

/** Width and height from a PNG's IHDR chunk, which always comes first. */
function pngSize(path: string): string {
  const bytes = readFileSync(path);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

describe("the brand icons", () => {
  const PUBLIC = join(import.meta.dirname, "..", "..", "public");

  test("each declared icon exists in public/ with the size it declares", () => {
    for (const brand of Object.values(BRANDS)) {
      for (const icon of brand.icons ? Object.values(brand.icons) : []) {
        assert.equal(pngSize(join(PUBLIC, icon.url)), icon.sizes, icon.url);
      }
    }
  });
});

/*
 * The brand is written in one place. A screen that writes "Chelsea St" again
 * would show it on every host, the GrifoAI one and an unknown one included.
 */
describe("the brand name in src/", () => {
  const SRC = join(import.meta.dirname, "..");
  const TEXT = /\.(ts|tsx|js|jsx|mjs|css|json|md)$/;

  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    });
  }

  test("appears only in src/lib/brand.ts and in tests", () => {
    const offenders = files(SRC)
      .filter((path) => TEXT.test(path) && !/\.test\.tsx?$/.test(path))
      .map((path) => relative(SRC, path))
      .filter((path) => path !== join("lib", "brand.ts"))
      .filter((path) =>
        /chelsea st/i.test(readFileSync(join(SRC, path), "utf8")),
      );
    assert.deepEqual(offenders, []);
  });
});
