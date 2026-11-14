import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  KNOWN_REFUSALS,
  refusalSentence,
  UNKNOWN_REFUSAL,
} from "./refusals.ts";

function migration(name: string): string {
  return readFileSync(
    join(import.meta.dirname, "../../../supabase/migrations", name),
    "utf8",
  );
}

const MIGRATION = migration("0052_a_lesson_is_booked_and_paid.sql");
const PROPOSALS = migration("0057_a_proposed_lesson_waits_for_a_yes.sql");

/** Every name a migration refuses under: its raises and its named constraints. */
function namesOf(sql: string, kinds = "check|exclude"): string[] {
  const raised = [...sql.matchAll(/constraint = '([a-z_]+)'/g)].map(
    (match) => match[1],
  );
  const declared = [
    ...sql.matchAll(new RegExp(`constraint ([a-z_]+)\\s+(?:${kinds})`, "g")),
  ].map((match) => match[1]);
  const exclusions = [...sql.matchAll(/add constraint ([a-z_]+) exclude/g)].map(
    (match) => match[1],
  );
  const indexes = [...sql.matchAll(/create unique index ([a-z_]+)/g)].map(
    (match) => match[1],
  );
  return [...new Set([...raised, ...declared, ...exclusions, ...indexes])];
}

function namesOf0052(): string[] {
  return namesOf(MIGRATION);
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

  test("every refusal a person can meet in 0057 has a sentence", () => {
    const names = namesOf(PROPOSALS, "check|exclude|unique");
    // The shapes no screen sends: a state, a side, a time or a length the
    // functions write themselves, and the e-mail queue nobody writes.
    const unseen = new Set([
      "lesson_proposals_proposed_by_known",
      "lesson_proposals_status_known",
      "lesson_proposals_expires_after_creation",
      "lesson_proposals_answered_when_closed",
      "lesson_proposals_answered_by_a_side",
      "lesson_proposal_items_duration_positive",
      "lesson_proposal_items_lesson_once",
      "lesson_proposal_items_whole_minute",
      "lesson_proposal_mails_one_per_proposal",
      "lesson_proposal_mails_recipient_known",
      "lesson_proposal_mails_status_known",
      "lesson_proposal_mails_attempts_not_negative",
      "lesson_proposal_mails_last_error_short",
      "lesson_proposal_mails_sent_has_time",
    ]);
    assert.ok(names.length > 25, `read ${names.length} names from 0057`);
    for (const name of names) {
      if (unseen.has(name)) continue;
      assert.ok(KNOWN_REFUSALS.includes(name), `${name} has no sentence`);
    }
  });

  test("a proposal's refusals, raised and from an index", () => {
    assert.equal(
      refusalSentence(
        "lesson_proposal_open: the proposal is not open any more",
      ),
      "Essa proposta já não está aberta.",
    );
    assert.equal(
      refusalSentence(
        'duplicate key value violates unique constraint "lesson_proposal_one_open"',
      ),
      "Você já tem uma proposta aberta para esse professor. Retire-a para propor outra.",
    );
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
    assert.equal(
      refusalSentence("credit_refund_open: person x has a refund request open"),
      "Seu reembolso está em andamento. Novas aulas ficam para depois dele.",
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
