import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SUBSCRIBE_REFUSALS } from "./messages.ts";
import { STORE_REFUSALS } from "./refusal-names.ts";

describe("STORE_REFUSALS", () => {
  test("every refusal of the database the subscribe screen names reaches it as a StoreRefusal", () => {
    // invalid_cpf and invalid_name are the app's own checks, never the
    // database's; every other key of SUBSCRIBE_REFUSALS is a constraint the
    // real store must recognise, or the sentence never reaches the screen
    // (the fake store raises any name it is given).
    const fromDatabase = Object.keys(SUBSCRIBE_REFUSALS).filter(
      (name) => name !== "invalid_cpf" && name !== "invalid_name",
    );
    const missing = fromDatabase.filter(
      (name) => !STORE_REFUSALS.includes(name),
    );
    assert.deepEqual(missing, []);
  });
});
