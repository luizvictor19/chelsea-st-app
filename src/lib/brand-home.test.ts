import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveSite, sitesFromEnv, type BrandKey } from "./brand.ts";
import { homeSite } from "./brand-home.ts";

/** Production after #193: both domains, on Vercel. */
const BOTH = sitesFromEnv({ VERCEL: "1", GRIFOAI_HOST: "app.grifo.example" });

/** Production today: no GrifoAI domain yet. */
const CHELSEA_ONLY = sitesFromEnv({ VERCEL: "1" });

/** A dev server with the GrifoAI host on .localhost. */
const LOCAL = sitesFromEnv({ GRIFOAI_HOST: "grifoai.localhost:3100" });

function home(
  host: string | null,
  memberBrands: readonly BrandKey[],
  config = BOTH,
  platformAdmin = false,
) {
  return (
    homeSite({
      here: resolveSite(host, config),
      platformAdmin,
      memberBrands,
      config,
    })?.origin ?? null
  );
}

describe("homeSite", () => {
  test("a Chelsea student on the Chelsea host stays", () => {
    assert.equal(home("app.chelsea-st.com", ["chelsea-st"]), null);
  });

  test("a GrifoAI employee on the Chelsea host goes to GrifoAI's", () => {
    assert.equal(
      home("app.chelsea-st.com", ["grifoai"]),
      "https://app.grifo.example",
    );
  });

  test("a Chelsea account on the GrifoAI host goes to Chelsea's", () => {
    assert.equal(
      home("app.grifo.example", ["chelsea-st"]),
      "https://app.chelsea-st.com",
    );
  });

  test("someone in organizations of both brands stays where she is", () => {
    assert.equal(home("app.chelsea-st.com", ["grifoai", "chelsea-st"]), null);
    assert.equal(home("app.grifo.example", ["chelsea-st", "grifoai"]), null);
  });

  test("a platform admin is never sent anywhere", () => {
    assert.equal(home("app.chelsea-st.com", ["grifoai"], BOTH, true), null);
    assert.equal(home("app.grifo.example", ["chelsea-st"], BOTH, true), null);
  });

  test("someone with no organization stays, for the pending account screen", () => {
    assert.equal(home("app.chelsea-st.com", []), null);
    assert.equal(home("app.grifo.example", []), null);
  });

  test("a brand with no site sends nobody: no GrifoAI domain yet", () => {
    assert.equal(home("app.chelsea-st.com", ["grifoai"], CHELSEA_ONLY), null);
  });

  test("a host outside the list sends nobody", () => {
    assert.equal(home("chelsea-st-app.vercel.app", ["grifoai"]), null);
    assert.equal(home(null, ["chelsea-st"]), null);
  });

  test("a dev server sends to the other brand's dev host, never to https", () => {
    assert.equal(
      home("localhost:3100", ["grifoai"], LOCAL),
      "http://grifoai.localhost:3100",
    );
    assert.equal(home("grifoai.localhost:3100", ["chelsea-st"], LOCAL), null);
  });

  test("production never sends to a dev host", () => {
    const mixed = sitesFromEnv({
      VERCEL: "1",
      GRIFOAI_HOST: "grifoai.localhost:3100",
    });
    assert.equal(home("app.chelsea-st.com", ["grifoai"], mixed), null);
  });

  test("repeated memberships of one brand count once", () => {
    assert.equal(
      home("app.chelsea-st.com", ["grifoai", "grifoai"]),
      "https://app.grifo.example",
    );
  });
});
