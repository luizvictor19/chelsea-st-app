import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { magicLinkOutcome } from "./magic-link.ts";

describe("magicLinkOutcome", () => {
  test("an address without an account reads as sent, like any other", () => {
    // shouldCreateUser: false, and no account behind the address.
    assert.equal(magicLinkOutcome("otp_disabled", true), "sent");
    // The same, once sign-ups are off in the Auth dashboard.
    assert.equal(magicLinkOutcome("signup_disabled", true), "sent");
  });

  test("a link that went out is sent", () => {
    assert.equal(magicLinkOutcome(undefined, false), "sent");
  });

  test("a real failure is said as one", () => {
    assert.equal(magicLinkOutcome("over_email_send_rate_limit", true), "error");
    assert.equal(magicLinkOutcome(undefined, true), "error");
  });
});
