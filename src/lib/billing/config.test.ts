import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PRODUCTION_URL,
  SANDBOX_URL,
  asaasConfig,
  cpfKey,
  webhookToken,
} from "./config.ts";

describe("asaasConfig", () => {
  test("the address follows the key", () => {
    assert.deepEqual(asaasConfig({ ASAAS_API_KEY: "$aact_hmlg_x" }), {
      apiKey: "$aact_hmlg_x",
      baseUrl: SANDBOX_URL,
      sandbox: true,
    });
    assert.equal(
      asaasConfig({ ASAAS_API_KEY: "$aact_prod_x", VERCEL_ENV: "production" })
        .baseUrl,
      PRODUCTION_URL,
    );
  });

  test("an empty key says how to write it", () => {
    assert.throws(() => asaasConfig({ ASAAS_API_KEY: "" }), /\\\$aact_/);
    assert.throws(() => asaasConfig({}), /is empty/);
  });

  test("a key of another shape is refused", () => {
    assert.throws(
      () => asaasConfig({ ASAAS_API_KEY: "aact_hmlg_x" }),
      /does not start/,
    );
  });

  test("the sandbox key is refused in Vercel Production", () => {
    assert.throws(
      () =>
        asaasConfig({
          ASAAS_API_KEY: "$aact_hmlg_x",
          VERCEL_ENV: "production",
        }),
      /refused in Vercel Production/,
    );
    assert.equal(
      asaasConfig({ ASAAS_API_KEY: "$aact_hmlg_x", VERCEL_ENV: "preview" })
        .sandbox,
      true,
    );
  });

  test("the webhook token and the CPF key need their length", () => {
    assert.throws(() => webhookToken({ ASAAS_WEBHOOK_TOKEN: "short" }));
    assert.throws(() => webhookToken({}));
    assert.equal(
      webhookToken({ ASAAS_WEBHOOK_TOKEN: "t".repeat(64) }).length,
      64,
    );
    assert.throws(() => cpfKey({ BILLING_CPF_KEY: "x" }));
    assert.equal(cpfKey({ BILLING_CPF_KEY: "k".repeat(64) }).length, 64);
  });

  // Found on 12/11: .env.local points at production, and a dev server with
  // the sandbox key would write test subscriptions into it.
  test("the sandbox key runs only against a local database", () => {
    const sandbox = { ASAAS_API_KEY: "$aact_hmlg_x" };
    assert.throws(
      () =>
        asaasConfig({
          ...sandbox,
          NEXT_PUBLIC_SUPABASE_URL: "https://gmgkoriwsmlrtwdqdsuo.supabase.co",
        }),
      /only against a local Supabase/,
    );
    assert.throws(
      () => asaasConfig({ ...sandbox, NEXT_PUBLIC_SUPABASE_URL: "not a url" }),
      /only against a local Supabase/,
    );
    for (const local of ["http://127.0.0.1:54321", "http://localhost:54321"]) {
      assert.equal(
        asaasConfig({ ...sandbox, NEXT_PUBLIC_SUPABASE_URL: local }).sandbox,
        true,
      );
    }
    // A script that writes no database gives no URL.
    assert.equal(asaasConfig(sandbox).sandbox, true);
    // The production key is not held to it.
    assert.equal(
      asaasConfig({
        ASAAS_API_KEY: "$aact_prod_x",
        NEXT_PUBLIC_SUPABASE_URL: "https://gmgkoriwsmlrtwdqdsuo.supabase.co",
      }).sandbox,
      false,
    );
  });
});
