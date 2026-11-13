import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  withFounderTerms,
  type SealTerms,
  type ShownPlan,
} from "./founder-terms.ts";

const FOUNDER: ShownPlan & { readonly id: string } = {
  id: "plan-f",
  audience: "founder",
  monthlyPriceCents: 700,
  annualPriceCents: 7000,
  monthlyCredits: 6,
  teacherLessonCredits: 3,
};

const FIXED: SealTerms = {
  termsFixedAt: "2026-11-13T12:00:00Z",
  monthlyPriceCents: 500,
  annualPriceCents: 5000,
  monthlyCredits: 8,
  teacherLessonCredits: null,
};

describe("withFounderTerms", () => {
  test("a founder plan with her terms fixed shows and charges her terms", () => {
    const shown = withFounderTerms(FOUNDER, FIXED);
    assert.equal(shown.id, "plan-f");
    assert.equal(shown.monthlyPriceCents, 500);
    assert.equal(shown.annualPriceCents, 5000);
    assert.equal(shown.monthlyCredits, 8);
    // Null in her terms is the brand's cost, as on a plan.
    assert.equal(shown.teacherLessonCredits, null);
    assert.deepEqual(shown.terms, {
      monthlyPriceCents: 500,
      annualPriceCents: 5000,
    });
  });

  test("no seal, no terms yet, or a plan that is not the founder's: the plan as it is", () => {
    assert.equal(withFounderTerms(FOUNDER, null), FOUNDER);
    const unfixed = { ...FIXED, termsFixedAt: null };
    assert.equal(withFounderTerms(FOUNDER, unfixed), FOUNDER);
    for (const missing of [
      "monthlyPriceCents",
      "annualPriceCents",
      "monthlyCredits",
    ] as const) {
      const broken = { ...FIXED, [missing]: null };
      assert.equal(withFounderTerms(FOUNDER, broken), FOUNDER, missing);
    }
    const publicPlan = { ...FOUNDER, audience: "public" };
    assert.equal(withFounderTerms(publicPlan, FIXED), publicPlan);
  });
});
