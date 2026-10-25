import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sessionCookieNames } from "./session-cookies.ts";

describe("sessionCookieNames", () => {
  test("takes the token, its chunks and the code verifier", () => {
    assert.deepEqual(
      sessionCookieNames([
        "sb-gmgkoriwsmlrtwdqdsuo-auth-token",
        "sb-gmgkoriwsmlrtwdqdsuo-auth-token.0",
        "sb-gmgkoriwsmlrtwdqdsuo-auth-token.1",
        "sb-gmgkoriwsmlrtwdqdsuo-auth-token-code-verifier",
      ]),
      [
        "sb-gmgkoriwsmlrtwdqdsuo-auth-token",
        "sb-gmgkoriwsmlrtwdqdsuo-auth-token.0",
        "sb-gmgkoriwsmlrtwdqdsuo-auth-token.1",
        "sb-gmgkoriwsmlrtwdqdsuo-auth-token-code-verifier",
      ],
    );
  });

  test("leaves every other cookie of the site alone", () => {
    assert.deepEqual(
      sessionCookieNames(["theme", "__next_hmr", "my-sb-thing"]),
      [],
    );
  });
});
