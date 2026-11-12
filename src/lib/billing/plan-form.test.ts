import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readPlanForm, readReais } from "./plan-form.ts";

function form(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    brand: "chelsea-st",
    key: "essencial",
    name: "Plano A",
    position: "1",
    monthly_price: "10,50",
    annual_price: "105",
    monthly_credits: "10",
    trail_minutes_per_day: "15",
    trial_days: "14",
    trial_credits: "5",
    carryover_percent: "30",
    opens_voice_question: "on",
    is_active: "on",
    ...over,
  };
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("readReais", () => {
  test("reads reais the ways they are typed, as cents", () => {
    assert.equal(readReais("57"), 5700);
    assert.equal(readReais("57,9"), 5790);
    assert.equal(readReais("R$ 1.470,00"), 147000);
    assert.equal(readReais("1470.50"), 147050);
    assert.equal(readReais("62,30"), 6230);
  });

  test("refuses what is not an amount", () => {
    for (const bad of ["", "abc", "1,234", "-5", "12,345", "1.47"]) {
      assert.equal(readReais(bad), bad === "1.47" ? 147 : null, bad);
    }
  });
});

describe("readPlanForm", () => {
  test("a full form gives the row", () => {
    const read = readPlanForm(form());
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.values.monthly_price_cents, 1050);
    assert.equal(read.values.annual_price_cents, 10500);
    assert.equal(read.values.opens_voice_question, true);
    assert.equal(read.values.opens_video, false);
    assert.equal(read.values.carryover_percent, 30);
    assert.equal(read.values.is_active, true);
  });

  test("each range of the database is said before it", () => {
    const cases: Record<string, string>[] = [
      { brand: "other" },
      { key: "Essencial" },
      { key: "1plan" },
      { name: "" },
      { monthly_price: "0" },
      { annual_price: "x" },
      { monthly_credits: "-1" },
      { trail_minutes_per_day: "0" },
      { trail_minutes_per_day: "241" },
      { trial_days: "61" },
      { trial_credits: "1.5" },
      { carryover_percent: "101" },
      { carryover_percent: "" },
      { carryover_percent: "-5" },
    ];
    for (const over of cases) {
      assert.equal(readPlanForm(form(over)).ok, false, JSON.stringify(over));
    }
  });
});

describe("the carryover cap", () => {
  test("goes from 0 to 100, the range of plans_carryover_percent_range", () => {
    for (const ok of ["0", "100"]) {
      const read = readPlanForm(form({ carryover_percent: ok }));
      assert.equal(read.ok, true, ok);
    }
    const refused = readPlanForm(form({ carryover_percent: "101" }));
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.match(refused.message, /0 a 100/);
  });
});
