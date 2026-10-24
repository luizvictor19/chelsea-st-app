import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  looksLikeEmail,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  passwordProblem,
} from "./credentials.ts";

describe("credentials", () => {
  test("an email is compared the way the database stores it", () => {
    assert.equal(
      normalizeEmail("  Ana.Souza@Example.COM "),
      "ana.souza@example.com",
    );
    assert.equal(normalizeEmail(null), "");
  });

  test("only the obvious non-addresses are refused", () => {
    assert.equal(looksLikeEmail("ana@example.com"), true);
    assert.equal(looksLikeEmail("ana+escola@sub.example.com.br"), true);
    assert.equal(looksLikeEmail("ana"), false);
    assert.equal(looksLikeEmail("ana@example"), false);
    assert.equal(looksLikeEmail("ana @example.com"), false);
  });

  test("a password needs the minimum length and the same text twice", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    const enough = "a".repeat(MIN_PASSWORD_LENGTH);
    assert.match(passwordProblem(short, short) ?? "", /pelo menos 8/);
    assert.match(passwordProblem(enough, `${enough}b`) ?? "", /não são iguais/);
    assert.equal(passwordProblem(enough, enough), null);
  });

  test("the length is checked before the confirmation", () => {
    assert.match(passwordProblem("abc", "xyz") ?? "", /pelo menos/);
  });
});
