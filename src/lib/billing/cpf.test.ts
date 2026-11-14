import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cpfDigits, cpfHmac, isValidCpf } from "./cpf.ts";

// Made-up CPFs with valid check digits, generated for these tests.
const VALID = "529.982.247-25";
const KEY = "k".repeat(32);

describe("cpf", () => {
  test("reads the digits with or without punctuation", () => {
    assert.equal(cpfDigits(VALID), "52998224725");
    assert.equal(cpfDigits("52998224725"), "52998224725");
    assert.equal(cpfDigits(" 529 982 247 25 "), "52998224725");
    assert.equal(cpfDigits("5299822472"), null);
    assert.equal(cpfDigits("52998224725a"), null);
  });

  test("checks both check digits", () => {
    assert.equal(isValidCpf(VALID), true);
    assert.equal(isValidCpf("529.982.247-24"), false);
    assert.equal(isValidCpf("529.982.247-15"), false);
    assert.equal(isValidCpf("123"), false);
  });

  test("refuses a digit repeated eleven times", () => {
    assert.equal(isValidCpf("111.111.111-11"), false);
    assert.equal(isValidCpf("00000000000"), false);
  });

  test("the same CPF with and without punctuation gives the same HMAC", () => {
    assert.equal(cpfHmac(VALID, KEY), cpfHmac("52998224725", KEY));
    assert.match(cpfHmac(VALID, KEY), /^[0-9a-f]{64}$/);
  });

  test("the HMAC depends on the key and holds no digit run of the CPF", () => {
    const one = cpfHmac(VALID, KEY);
    assert.notEqual(one, cpfHmac(VALID, "j".repeat(32)));
    assert.equal(one.includes("52998224725"), false);
  });

  test("refuses a short key and a value that is not a CPF", () => {
    assert.throws(() => cpfHmac(VALID, "short"), /BILLING_CPF_KEY/);
    assert.throws(() => cpfHmac("123", KEY), /Not a CPF/);
  });
});
