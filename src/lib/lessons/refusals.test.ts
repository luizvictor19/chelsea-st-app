import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  KNOWN_REFUSALS,
  refusalSentence,
  UNKNOWN_REFUSAL,
} from "./refusals.ts";

const MIGRATION = readFileSync(
  join(
    import.meta.dirname,
    "../../../supabase/migrations/0052_a_lesson_is_booked_and_paid.sql",
  ),
  "utf8",
);

/** Every name 0052 refuses under: its raises and its named constraints. */
function namesOf0052(): string[] {
  const raised = [...MIGRATION.matchAll(/constraint = '([a-z_]+)'/g)].map(
    (match) => match[1],
  );
  const declared = [
    ...MIGRATION.matchAll(/constraint ([a-z_]+)\s+(?:check|exclude)/g),
  ].map((match) => match[1]);
  const exclusions = [
    ...MIGRATION.matchAll(/add constraint ([a-z_]+) exclude/g),
  ].map((match) => match[1]);
  return [...new Set([...raised, ...declared, ...exclusions])];
}

describe("refusalSentence", () => {
  test("every refusal a person can meet in 0052 has a sentence", () => {
    const names = namesOf0052();
    // The shape checks a screen never sends (the form reads them first, or
    // no form writes the column) are left out, by name.
    const unseen = new Set([
      "teachers_member_teaches",
      "teacher_availability_weekday_range",
      "lessons_credits_debited_not_negative",
      "lessons_refund_needs_debit",
      "lessons_cancelled_is_cancelled",
    ]);
    assert.ok(names.length > 15, `read ${names.length} names from 0052`);
    for (const name of names) {
      if (unseen.has(name)) continue;
      assert.ok(KNOWN_REFUSALS.includes(name), `${name} has no sentence`);
    }
  });

  test("finds the rule at the start of a raised message", () => {
    assert.equal(
      refusalSentence(
        "lesson_slot_bookable: 2026-11-16 13:00:00+00 is not a free slot of this teacher",
      ),
      "Esse horário não está mais livre. Escolha outro.",
    );
    assert.equal(
      refusalSentence(
        "credits_not_negative: teacher_lesson costs 4, and person x has 1",
      ),
      "Seu saldo não cobre esta aula.",
    );
  });

  test("finds the rule Postgres names inside its own message", () => {
    assert.equal(
      refusalSentence(
        'conflicting key value violates exclusion constraint "lessons_teacher_no_overlap"',
      ),
      "Esse horário acabou de ser reservado. Escolha outro.",
    );
  });

  test("an unknown or empty message is said, never blank", () => {
    assert.equal(
      refusalSentence("permission denied for function x"),
      UNKNOWN_REFUSAL,
    );
    assert.equal(refusalSentence(undefined), UNKNOWN_REFUSAL);
    assert.equal(refusalSentence(null), UNKNOWN_REFUSAL);
    assert.ok(UNKNOWN_REFUSAL.length > 0);
  });

  test("the longer name wins over a shorter one it holds", () => {
    // teacher_availability_ends_after_start and teacher_time_off_ends_after_start
    // share a tail; each finds its own.
    assert.match(
      refusalSentence(
        'new row violates check constraint "teacher_time_off_ends_after_start"',
      ),
      /folga/,
    );
  });
});
