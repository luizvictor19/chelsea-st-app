import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readSeatsForm, sealRefusal } from "./seats-form.ts";

function form(value: string | null): FormData {
  const data = new FormData();
  if (value !== null) data.set("seats_total", value);
  return data;
}

describe("readSeatsForm", () => {
  test("a whole number, zero included, trimmed", () => {
    assert.deepEqual(readSeatsForm(form(" 7 ")), { ok: true, seats: 7 });
    assert.deepEqual(readSeatsForm(form("0")), { ok: true, seats: 0 });
  });

  test("refuses negative, decimal, text, empty and absurd (founder_program_seats_not_negative)", () => {
    for (const bad of ["-1", "1.5", "dez", "", "100001", null]) {
      const read = readSeatsForm(form(bad));
      assert.equal(read.ok, false, String(bad));
      if (!read.ok) assert.match(read.message, /zero ou mais/);
    }
  });
});

describe("sealRefusal", () => {
  test("no seat left, by its name", () => {
    assert.match(
      sealRefusal({
        code: "23514",
        message: "founder_seats_available: no founder seat is left",
      }),
      /Não há vaga/,
    );
  });

  test("not the platform admin, and anything else", () => {
    assert.match(sealRefusal({ code: "42501" }), /admin da plataforma/);
    assert.match(sealRefusal({}), /Tente de novo/);
  });
});
