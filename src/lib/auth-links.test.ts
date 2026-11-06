import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  inviteOptions,
  magicLinkOptions,
  recoveryOptions,
} from "./auth-links.ts";
import { resolveSite, sitesFromEnv, type SiteConfig } from "./brand.ts";

/** Production after #193: the GrifoAI domain set, on Vercel. */
const PRODUCTION = sitesFromEnv({
  GRIFOAI_HOST: "app.grifo.example",
  VERCEL: "1",
});

/** A dev server, where loopback is Chelsea. */
const LOCAL = sitesFromEnv({});

/** The three flows, each reduced to the origin it hands to Supabase. */
function origins(host: string | null, config: SiteConfig) {
  const site = resolveSite(host, config);
  return {
    magicLink: magicLinkOptions(site).emailRedirectTo,
    recovery: recoveryOptions(site).redirectTo,
    invite: inviteOptions(site).redirectTo,
  };
}

function allThree(origin: string) {
  return { magicLink: origin, recovery: origin, invite: origin };
}

/** A dev origin: the person who asked reads the link on the same machine. */
function selfOnly(origin: string) {
  return { magicLink: origin, recovery: origin, invite: undefined };
}

describe("auth links follow the site of the request", () => {
  test("Chelsea: the three flows lead to https://app.chelsea-st.com", () => {
    assert.deepEqual(
      origins("app.chelsea-st.com", PRODUCTION),
      allThree("https://app.chelsea-st.com"),
    );
  });

  test("GrifoAI: the three flows lead to its own domain", () => {
    assert.deepEqual(
      origins("app.grifo.example", PRODUCTION),
      allThree("https://app.grifo.example"),
    );
  });

  test("GrifoAI on a dev server: http and the port, invite aside", () => {
    const local = sitesFromEnv({ GRIFOAI_HOST: "grifoai.localhost:3100" });
    assert.deepEqual(
      origins("grifoai.localhost:3100", local),
      selfOnly("http://grifoai.localhost:3100"),
    );
  });

  test("loopback off Vercel: the request's own host and port, invite aside", () => {
    assert.deepEqual(
      origins("127.0.0.1:3100", LOCAL),
      selfOnly("http://127.0.0.1:3100"),
    );
    assert.deepEqual(
      origins("localhost:3100", LOCAL),
      selfOnly("http://localhost:3100"),
    );
  });

  test("an invite from a dev server sends no redirect", () => {
    // The dev server talks to the production project, and the invitee opens
    // the email on her own machine, where a loopback link leads nowhere.
    for (const host of ["localhost:3100", "127.0.0.1:3100"]) {
      assert.deepEqual(inviteOptions(resolveSite(host, LOCAL)), {});
    }
  });

  test("the magic link never creates an account, whatever the host", () => {
    for (const host of ["app.chelsea-st.com", "evil.com", null]) {
      const site = resolveSite(host, PRODUCTION);
      assert.equal(magicLinkOptions(site).shouldCreateUser, false);
    }
  });
});

describe("a host outside the list sends no redirect at all", () => {
  // Supabase then uses its Site URL, as a preview does today. A forged Host
  // must never become the start of an email link that carries a token_hash.
  const unknown: readonly [string, string | null, SiteConfig][] = [
    ["an unknown host", "evil.com", PRODUCTION],
    ["a suffix attack", "app.chelsea-st.com.evil.com", PRODUCTION],
    ["a prefix attack", "evil.app.chelsea-st.com", PRODUCTION],
    ["a listed host on another port", "app.chelsea-st.com:8443", PRODUCTION],
    ["credentials in the Host", "evil.com@app.chelsea-st.com", PRODUCTION],
    ["loopback on Vercel", "localhost:3100", PRODUCTION],
    ["127.0.0.1 on Vercel", "127.0.0.1:3100", PRODUCTION],
    ["a preview", "chelsea-st-git-x-acct.vercel.app", PRODUCTION],
    ["no Host", null, PRODUCTION],
    ["an unknown host off Vercel", "evil.com", LOCAL],
  ];

  for (const [name, host, config] of unknown) {
    test(name, () => {
      const site = resolveSite(host, config);
      assert.deepEqual(magicLinkOptions(site), { shouldCreateUser: false });
      assert.deepEqual(recoveryOptions(site), {});
      assert.deepEqual(inviteOptions(site), {});
      assert.equal("emailRedirectTo" in magicLinkOptions(site), false);
      assert.equal("redirectTo" in recoveryOptions(site), false);
      assert.equal("redirectTo" in inviteOptions(site), false);
    });
  }
});

describe("the redirect is an origin and nothing more", () => {
  // The templates add /auth/callback?token_hash=…; when Supabase refuses the
  // value it puts the Site URL in its place, and the link is still whole.
  const known: readonly [string, SiteConfig][] = [
    ["app.chelsea-st.com", PRODUCTION],
    ["app.grifo.example", PRODUCTION],
    ["127.0.0.1:3100", LOCAL],
    ["localhost:3000", LOCAL],
  ];

  for (const [host, config] of known) {
    test(host, () => {
      const { magicLink, recovery, invite } = origins(host, config);
      assert.ok(magicLink && recovery, `no redirect for ${host}`);
      for (const origin of [magicLink, recovery, invite]) {
        if (origin === undefined) {
          continue;
        }
        assert.equal(new URL(origin).origin, origin);
        assert.ok(!origin.endsWith("/"), `${origin} ends with a slash`);
      }
    });
  }
});

describe("the email templates in docs/commands.md", () => {
  const COMMANDS = join(import.meta.dirname, "..", "..", "docs", "commands.md");
  const doc = readFileSync(COMMANDS, "utf8");
  const LINK = "/auth/callback?token_hash=";
  const START = "{{ .RedirectTo }}";

  test("every link starts with {{ .RedirectTo }}", () => {
    // With {{ .SiteURL }} every email leads to the Chelsea domain, and
    // GrifoAI loses its own.
    const starts: string[] = [];
    for (
      let at = doc.indexOf(LINK);
      at !== -1;
      at = doc.indexOf(LINK, at + 1)
    ) {
      starts.push(doc.slice(Math.max(0, at - START.length), at));
    }
    // Four in the summary table and four in the bodies.
    assert.equal(starts.length, 8);
    for (const start of starts) {
      assert.equal(start, START);
    }
  });
});
