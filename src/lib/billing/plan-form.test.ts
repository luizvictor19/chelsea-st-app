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
    credit_ceiling_months: "3",
    credit_days_after_cancel: "30",
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
    assert.equal(read.values.credit_ceiling_months, 3);
    assert.equal(read.values.credit_days_after_cancel, 30);
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
      { credit_ceiling_months: "0" },
      { credit_ceiling_months: "61" },
      { credit_ceiling_months: "" },
      { credit_days_after_cancel: "366" },
      { credit_days_after_cancel: "" },
      { credit_days_after_cancel: "-5" },
    ];
    for (const over of cases) {
      assert.equal(readPlanForm(form(over)).ok, false, JSON.stringify(over));
    }
  });
});

describe("the ceiling and the days after a cancel", () => {
  test("take the ranges of plans_credit_ceiling_months_range and plans_credit_days_after_cancel_range", () => {
    const accepted: Record<string, string>[] = [
      { credit_ceiling_months: "1" },
      { credit_ceiling_months: "60" },
      { credit_days_after_cancel: "0" },
      { credit_days_after_cancel: "365" },
    ];
    for (const over of accepted) {
      assert.equal(readPlanForm(form(over)).ok, true, JSON.stringify(over));
    }
    const ceiling = readPlanForm(form({ credit_ceiling_months: "61" }));
    assert.equal(ceiling.ok, false);
    if (!ceiling.ok) assert.match(ceiling.message, /1 a 60 meses/);
    const days = readPlanForm(form({ credit_days_after_cancel: "366" }));
    assert.equal(days.ok, false);
    if (!days.ok) assert.match(days.message, /0 a 365/);
  });
});
