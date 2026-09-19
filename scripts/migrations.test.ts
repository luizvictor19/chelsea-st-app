import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * The list of migrations inside scripts/verify-rls.sql is written by hand, and
 * a hand-written list drifts in silence. A migration left out of it is not
 * applied to the container the row level security check runs against, so the
 * check passes without ever having seen the schema it claims to verify, and
 * the gate goes green having proved less than it did the day before.
 *
 * That happened with 0013 on 2026-09-19, and nothing said so.
 */
const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/**
 * Migrations the script leaves out on purpose, each with the reason.
 *
 * An entry here is a decision, so adding one means writing down why. The
 * default is that a migration belongs in the script: it changes the schema,
 * and the schema is what is being verified.
 */
const LEFT_OUT = new Map([
  [
    "0007_seed_books.sql",
    "reference data, not schema, and its twelve books collide with the one book the script inserts for itself",
  ],
]);

function migrationFiles(): readonly string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function includedInScript(): readonly string[] {
  const script = readFileSync(join(ROOT, "scripts", "verify-rls.sql"), "utf8");
  return [...script.matchAll(/^\\i supabase\/migrations\/(.+\.sql)$/gm)].map(
    (match) => match[1],
  );
}

describe("verify-rls.sql", () => {
  test("applies every migration that is not deliberately left out", () => {
    const included = new Set(includedInScript());
    const missing = migrationFiles().filter(
      (name) => !included.has(name) && !LEFT_OUT.has(name),
    );
    assert.deepEqual(
      missing,
      [],
      `not applied by scripts/verify-rls.sql: ${missing.join(", ")}. Add the \\i line, or record in LEFT_OUT why it does not belong.`,
    );
  });

  test("names no migration that no longer exists", () => {
    const files = new Set(migrationFiles());
    const stale = includedInScript().filter((name) => !files.has(name));
    assert.deepEqual(stale, [], `named but missing: ${stale.join(", ")}`);
  });

  /*
   * psql runs them in the order written, and a migration that alters what a
   * later one creates would fail out of order. The filenames are numbered for
   * exactly this reason, so the script has to follow the numbers.
   */
  test("applies them in the order the numbers give", () => {
    const included = includedInScript();
    assert.deepEqual([...included].sort(), included);
  });

  test("leaves nothing out without saying why", () => {
    for (const [name, reason] of LEFT_OUT) {
      assert.ok(migrationFiles().includes(name), `stale exclusion: ${name}`);
      assert.ok(reason.trim().length > 20, `thin reason for ${name}`);
    }
  });
});
