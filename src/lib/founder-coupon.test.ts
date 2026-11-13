import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  CODE_ALPHABET,
  COUPON_REFUSALS,
  couponCreateRefusal,
  couponGranted,
  couponLink,
  couponRefusal,
  groupCode,
  normalizeCode,
  personalCode,
  readCouponForm,
  signupCoupon,
} from "./founder-coupon.ts";

const MIGRATION = readFileSync(
  join(
    import.meta.dirname,
    "..",
    "..",
    "supabase",
    "migrations",
    "0059_a_founder_comes_by_coupon_or_invite.sql",
  ),
  "utf8",
);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("personalCode", () => {
  test("12 characters of Crockford's alphabet, none read as another", () => {
    let n = 0;
    const code = personalCode((max) => (n++ * 7) % max);
    assert.equal(code.length, 12);
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{12}$/);
    for (const ambiguous of ["I", "L", "O", "U"]) {
      assert.equal(CODE_ALPHABET.includes(ambiguous), false);
    }
    assert.equal(CODE_ALPHABET.length, 32);
  });

  test("takes every character from the random numbers it is given", () => {
    assert.equal(
      personalCode(() => 0),
      "000000000000",
    );
    assert.equal(
      personalCode((max) => max - 1),
      "ZZZZZZZZZZZZ",
    );
  });

  test("two codes in a row differ with node's random numbers", async () => {
    const { randomInt } = await import("node:crypto");
    assert.notEqual(personalCode(randomInt), personalCode(randomInt));
  });
});

describe("normalizeCode and groupCode", () => {
  test("capitals, no spaces and no hyphens, as founder_coupon_hash", () => {
    assert.equal(normalizeCode(" abcd-efgh ijkl\t"), "ABCDEFGHIJKL");
    assert.equal(normalizeCode(null), "");
  });

  test("grouped in fours", () => {
    assert.equal(groupCode("abcdefghjkmn"), "ABCD-EFGH-JKMN");
    assert.equal(groupCode("FUNDADOR"), "FUND-ADOR");
    assert.equal(groupCode(""), "");
  });

  test("the SQL makes a code normal the same way", () => {
    assert.match(
      MIGRATION,
      /regexp_replace\(coalesce\(p_code, ''\), '\[\[:space:\]-\]', '', 'g'\)/,
    );
  });
});

describe("signupCoupon", () => {
  test("trimmed, empty when absent, cut far beyond any code", () => {
    assert.equal(signupCoupon("  abcd-efgh "), "abcd-efgh");
    assert.equal(signupCoupon(null), "");
    assert.equal(signupCoupon("A".repeat(500)).length, 128);
  });
});

describe("COUPON_REFUSALS", () => {
  test("has a sentence for every rule redeem_my_founder_coupon raises, and no other", () => {
    const raised = new Set(
      [...MIGRATION.matchAll(/constraint = '(founder_coupon_[a-z_]+)'/g)].map(
        (match) => match[1],
      ),
    );
    assert.ok(raised.size >= 6);
    assert.deepEqual([...raised].sort(), Object.keys(COUPON_REFUSALS).sort());
  });

  test("the rule is read at the start of the message", () => {
    assert.equal(
      couponRefusal({
        message: "founder_coupon_expired: the founder coupon has expired",
      }),
      COUPON_REFUSALS.founder_coupon_expired,
    );
    assert.equal(
      couponRefusal({
        message: "founder_coupon_seats: no founder seat is left",
      }),
      "As vagas de fundador acabaram.",
    );
  });

  test("anything else asks to try again", () => {
    for (const message of [undefined, "", "boom", "constructor: x"]) {
      assert.match(couponRefusal({ message }), /Tente de novo/);
    }
  });
});

describe("couponGranted", () => {
  test("a seal given, and one held already", () => {
    assert.match(couponGranted("granted"), /ganhou o selo/);
    assert.equal(
      couponGranted("already_founder"),
      "Você já tem o selo de fundador.",
    );
  });
});

describe("readCouponForm", () => {
  test("a general coupon: its code made normal, its uses, its days", () => {
    assert.deepEqual(
      readCouponForm(
        form({
          kind: "general",
          code: " Fund-ador ",
          label: " Post ",
          max_uses: "7",
          days: "30",
        }),
      ),
      {
        ok: true,
        values: {
          kind: "general",
          code: "FUNDADOR",
          label: "Post",
          maxUses: 7,
          days: 30,
        },
      },
    );
  });

  test("a personal coupon: one use, no code typed", () => {
    assert.deepEqual(
      readCouponForm(
        form({
          kind: "personal",
          code: "ignored",
          label: "Ana",
          max_uses: "9",
          days: "15",
        }),
      ),
      {
        ok: true,
        values: {
          kind: "personal",
          code: null,
          label: "Ana",
          maxUses: 1,
          days: 15,
        },
      },
    );
  });

  test("refuses a short or long code, before the database does", () => {
    for (const code of ["ab-c d e", "A".repeat(65)]) {
      const read = readCouponForm(
        form({ code, label: "x", max_uses: "1", days: "1" }),
      );
      assert.equal(read.ok, false);
    }
  });

  test("refuses no label, a label too long, days out of range and uses that are not a whole number", () => {
    const base = { code: "FUNDADOR", label: "Post", max_uses: "1", days: "1" };
    for (const over of [
      { label: "  " },
      { label: "x".repeat(121) },
      { days: "0" },
      { days: "366" },
      { days: "1.5" },
      { max_uses: "0" },
      { max_uses: "-1" },
      { max_uses: "100001" },
      { max_uses: "" },
    ]) {
      assert.equal(
        readCouponForm(form({ ...base, ...over })).ok,
        false,
        JSON.stringify(over),
      );
    }
  });
});

describe("couponCreateRefusal", () => {
  test("names a repeated code, a bad length, someone else, and anything else", () => {
    assert.match(couponCreateRefusal({ code: "23505" }), /Já existe/);
    assert.match(
      couponCreateRefusal({
        code: "23514",
        message: "founder_coupons_code_length: x",
      }),
      /de 6 a 64/,
    );
    assert.match(couponCreateRefusal({ code: "42501" }), /Só o admin/);
    assert.match(couponCreateRefusal({}), /Tente de novo/);
  });
});

describe("couponLink", () => {
  test("the signup with the code, grouped, in ?cupom=", () => {
    const url = new URL(couponLink("https://app.example.com", "abcdefghjkmn"));
    assert.equal(url.pathname, "/cadastro");
    assert.equal(url.searchParams.get("cupom"), "ABCD-EFGH-JKMN");
  });
});
