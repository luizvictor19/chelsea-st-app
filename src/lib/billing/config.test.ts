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
});
