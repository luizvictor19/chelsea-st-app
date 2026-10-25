import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { magicLinkStep } from "./magic-link.ts";

describe("magicLinkStep", () => {
  test("a link that went out is sent", () => {
    assert.equal(magicLinkStep(null), "sent");
  });

  test("an address without an account reads as sent, like any other", () => {
    // shouldCreateUser: false, and no account behind the address.
    assert.equal(magicLinkStep({ code: "otp_disabled" }), "sent");
  });

  test("an invited account not yet confirmed gets the recovery link", () => {
    // GoTrue sends an unconfirmed account through Signup, which refuses once
    // sign-ups are off in the dashboard.
    assert.equal(magicLinkStep({ code: "signup_disabled" }), "recover");
  });

  test("a real failure is said as one", () => {
    assert.equal(
      magicLinkStep({ code: "over_email_send_rate_limit" }),
      "error",
    );
    assert.equal(magicLinkStep({}), "error");
  });
});
