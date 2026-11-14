import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readPersonalPlanForm, readPlanForm, readReais } from "./plan-form.ts";

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
      { trail_minutes_per_day: "-1" },
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

describe("the audience, the lesson and the trail of 0058", () => {
  test("no audience is everyone; founder is kept; person is refused here", () => {
    const plain = readPlanForm(form());
    assert.equal(plain.ok && plain.values.audience, "public");
    const founder = readPlanForm(
      form({ audience: "founder", annual_price: "" }),
    );
    assert.equal(founder.ok && founder.values.audience, "founder");
    for (const audience of ["person", "everyone"]) {
      const read = readPlanForm(form({ audience }));
      assert.equal(read.ok, false, audience);
      if (!read.ok) assert.match(read.message, /quem vê/);
    }
  });

  test("a founder plan is of the brand chelsea-st only (plans_founder_is_chelsea_st)", () => {
    const read = readPlanForm(
      form({ audience: "founder", brand: "grifoai", annual_price: "" }),
    );
    assert.equal(read.ok, false);
  });

  test("a personal plan's form keeps its audience: the values carry none", () => {
    const read = readPlanForm(
      form({ personal: "1", audience: "public", annual_price: "" }),
    );
    assert.equal(read.ok, true);
    if (read.ok) assert.equal("audience" in read.values, false);
  });

  test("the cost of a lesson: empty is the brand's, 0 and negative refused", () => {
    const empty = readPlanForm(form());
    assert.equal(empty.ok && empty.values.teacher_lesson_credits, null);
    const two = readPlanForm(form({ teacher_lesson_credits: " 2 " }));
    assert.equal(two.ok && two.values.teacher_lesson_credits, 2);
    for (const bad of ["0", "-1", "1.5", "x"]) {
      const read = readPlanForm(form({ teacher_lesson_credits: bad }));
      assert.equal(read.ok, false, bad);
    }
  });

  test("0 minutes of trail is a plan without it; 241 is refused", () => {
    const zero = readPlanForm(form({ trail_minutes_per_day: "0" }));
    assert.equal(zero.ok && zero.values.trail_minutes_per_day, 0);
    const over = readPlanForm(form({ trail_minutes_per_day: "241" }));
    assert.equal(over.ok, false);
    if (!over.ok) assert.match(over.message, /0 \(sem trilha\) a 240/);
  });
});

describe("readPersonalPlanForm", () => {
  test("the e-mail lower-cased and trimmed, the brand chelsea-st, the audience person", () => {
    const read = readPersonalPlanForm(
      form({
        person_email: "  Ana@Example.COM ",
        brand: "grifoai",
        annual_price: "",
      }),
    );
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.values.person_email, "ana@example.com");
    assert.equal(read.values.brand, "chelsea-st");
    assert.equal(read.values.audience, "person");
  });

  test("refuses what is not an e-mail, and the numbers as any plan", () => {
    for (const bad of ["", "ana", "ana@example", "a b@example.com"]) {
      const read = readPersonalPlanForm(form({ person_email: bad }));
      assert.equal(read.ok, false, bad);
    }
    const numbers = readPersonalPlanForm(
      form({
        person_email: "ana@example.com",
        monthly_price: "0",
        annual_price: "",
      }),
    );
    assert.equal(numbers.ok, false);
  });
});

describe("monthly only for founders (0062, #331)", () => {
  test("an empty annual price is a plan without the annual cycle", () => {
    for (const empty of ["", "  "]) {
      const read = readPlanForm(form({ annual_price: empty }));
      assert.equal(read.ok && read.values.annual_price_cents, null, empty);
    }
    const absent = new FormData();
    for (const [name, value] of form()) {
      if (name !== "annual_price") absent.append(name, value);
    }
    const read = readPlanForm(absent);
    assert.equal(read.ok && read.values.annual_price_cents, null);
  });

  test("a typed annual price is still more than zero (plans_annual_price_positive)", () => {
    for (const bad of ["0", "x", "-5"]) {
      const read = readPlanForm(form({ annual_price: bad }));
      assert.equal(read.ok, false, bad);
      if (!read.ok) assert.match(read.message, /anual/);
    }
  });

  test("a founder plan with an annual price is refused before the database (plans_monthly_only_for_founders)", () => {
    const read = readPlanForm(form({ audience: "founder" }));
    assert.equal(read.ok, false);
    if (!read.ok) assert.match(read.message, /só mensal/);
  });

  test("a personal plan, edited or written, with an annual price is refused", () => {
    const edited = readPlanForm(form({ personal: "1" }));
    assert.equal(edited.ok, false);
    if (!edited.ok) assert.match(edited.message, /só mensal/);
    const written = readPersonalPlanForm(
      form({ person_email: "ana@example.com" }),
    );
    assert.equal(written.ok, false);
    if (!written.ok) assert.match(written.message, /só mensal/);
  });

  test("a founder or personal plan without it passes, with no annual price", () => {
    const founder = readPlanForm(
      form({ audience: "founder", annual_price: "" }),
    );
    assert.equal(founder.ok && founder.values.annual_price_cents, null);
    const personal = readPersonalPlanForm(
      form({ person_email: "ana@example.com", annual_price: "" }),
    );
    assert.equal(personal.ok && personal.values.annual_price_cents, null);
  });
});
