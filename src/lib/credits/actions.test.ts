import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { PAID_STATUSES } from "../billing/provider.ts";

import {
  CREDIT_ACTION_LABEL,
  CREDIT_ACTIONS,
  isCreditAction,
} from "./actions.ts";

/*
 * Two lists written by hand twice, once in SQL and once here: the actions a
 * cost can be written for (credit_costs_action_known) and the statuses a
 * charge grants its credits by (credit_payment_grants). A value added to one
 * side alone drifts in silence: a cost the screen cannot name, or a charge
 * the webhook calls paid and the ledger does not. The list read is the
 * latest definition across the migrations, as in brand-keys.test.ts.
 */
const MIGRATIONS = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
);

function migrations(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: readFileSync(join(MIGRATIONS, file), "utf8"),
    }));
}

function quoted(list: string): string[] {
  return [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/** Every list after `pattern`, in order, or null where it cannot be read. */
function lists(name: string, pattern: RegExp): (string[] | null)[] {
  const found: (string[] | null)[] = [];
  for (const { sql } of migrations()) {
    for (const match of sql.matchAll(new RegExp(name, "g"))) {
      const defined = new RegExp(pattern.source, "iy");
      defined.lastIndex = match.index;
      const list = defined.exec(sql)?.[1];
      found.push(list === undefined ? null : quoted(list));
    }
  }
  return found;
}

describe("the credit actions", () => {
  test("are exactly the ones credit_costs_action_known accepts", () => {
    const found = lists(
      "credit_costs_action_known",
      /credit_costs_action_known\s+check\s*\(\s*action\s+in\s*\(([^)]*)\)\s*\)/,
    );
    assert.ok(found.length > 0, "credit_costs_action_known not found");
    assert.ok(
      found.every((list) => list !== null),
      "a mention of credit_costs_action_known this test cannot read",
    );
    assert.deepEqual(
      [...found[found.length - 1]!].sort(),
      [...CREDIT_ACTIONS].sort(),
    );
  });

  test("each has a name on the screen, and nothing else is one", () => {
    assert.deepEqual(
      Object.keys(CREDIT_ACTION_LABEL).sort(),
      [...CREDIT_ACTIONS].sort(),
    );
    assert.equal(isCreditAction("teacher_lesson"), true);
    assert.equal(isCreditAction("chat_question"), false);
    assert.equal(isCreditAction(null), false);
  });
});

describe("the statuses a charge grants its credits by", () => {
  test("are PAID_STATUSES", () => {
    const found = lists(
      "create (?:or replace )?function public\\.credit_payment_grants",
      /create (?:or replace )?function public\.credit_payment_grants[\s\S]*?asaas_status\s+in\s*\(([^)]*)\)/,
    );
    assert.ok(found.length > 0, "credit_payment_grants not found");
    const latest = found[found.length - 1];
    assert.ok(latest !== null, "the latest credit_payment_grants is not read");
    assert.deepEqual([...latest].sort(), [...PAID_STATUSES].sort());
  });
});
