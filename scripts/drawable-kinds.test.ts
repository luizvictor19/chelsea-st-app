import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { isDrawableKind } from "../src/lib/images/style.ts";

/**
 * Which kinds are drawn is written in three places, and they have to agree.
 *
 * The partial index that decides which words are still waiting for a picture,
 * the function that undoes an approval when a word is moved to a kind that
 * carries none, and isDrawableKind, which the screen and the prompt builder
 * both ask. Three readers of one idea, in two languages, and nothing in
 * Postgres or in TypeScript makes them agree.
 *
 * Unifying them in SQL was considered on 2026-09-20 and refused. An immutable
 * function inside an index predicate has a worse failure than the duplication:
 * editing the function's body does not rebuild the index, so the index quietly
 * goes on meaning what the old body said, and nothing turns red. Three visible
 * copies beat one invisible lie.
 *
 * So this is the repository's other answer, the one scripts/migrations.test.ts
 * and scripts/types-header.test.ts already use: when two copies have to agree,
 * a test reads both and fails if they do not. Both of those have bitten.
 *
 * It also covers a hole found on the same day. representation.test.ts checks
 * the screen's list against src/lib/supabase/types.ts, which is generated
 * output — so a database that has grown a value the application has not seen
 * leaves both sides of that comparison stale together, and the gate stays
 * green. Here the enum is read from the migrations, which are the source.
 */
const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** Every migration, in the order the numbers give. */
function migrations(): readonly { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS, name), "utf8"),
    }));
}

/** The quoted labels of a `('a', 'b')` list, in the order written. */
function labelsIn(list: string): readonly string[] {
  return [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

/**
 * The kinds named by the last definition this file can read, and a failure
 * when a later migration touches the same thing in a shape it cannot.
 *
 * Reading the last match alone was not enough, and the hole was found by
 * review on 2026-09-20 with a probe migration: a 0020 that redefined the
 * index back to `representation <> 'none'` matches no pattern here, so the
 * reader fell back to the text of 0019 and all five tests stayed green over
 * an index the database no longer had. That is the exact silence this file
 * exists to break, reproduced inside the file itself.
 *
 * So the last readable definition is found first, and then every migration
 * after it is required not to mention the thing at all. A later migration
 * either defines it in a shape this test reads — becoming the new last — or
 * turns it red. `mention` is matched at the start of a line so that a comment
 * naming the index or the function is not mistaken for a statement.
 */
function lastList(
  mention: RegExp,
  extract: RegExp,
  what: string,
): readonly string[] {
  const files = migrations();
  let defined = -1;
  let text: string | null = null;

  files.forEach(({ sql }, index) => {
    const matches = [...sql.matchAll(extract)];
    if (matches.length === 0) return;
    defined = index;
    text = matches[matches.length - 1][1];
  });

  assert.ok(text !== null, `no migration defines ${what}`);

  const later = files
    .slice(defined + 1)
    .filter(({ sql }) => mention.test(sql))
    .map(({ name }) => name);
  assert.deepEqual(
    later,
    [],
    `${later.join(", ")} touches ${what} after the last definition this test can read, in a shape it cannot read. Write it so the list of kinds is extracted, or this file goes on checking a statement the database no longer runs.`,
  );

  return labelsIn(text);
}

/** Every label representation_kind has, created and added. */
function enumLabels(): readonly string[] {
  const labels: string[] = [];
  for (const { sql } of migrations()) {
    const created =
      /create type representation_kind as enum\s*\(([^)]*)\)/i.exec(sql);
    if (created !== null) labels.push(...labelsIn(created[1]));

    for (const added of sql.matchAll(
      /alter type representation_kind add value(?: if not exists)? '([a-z_]+)'/gi,
    )) {
      labels.push(added[1]);
    }
  }
  assert.ok(
    labels.length > 0,
    "representation_kind is created by no migration",
  );
  return labels;
}

/** The kinds the pending-image index counts as still waiting for a picture. */
function kindsInIndex(): readonly string[] {
  return lastList(
    /^\s*(?:create|drop)\s+index\s+[^;]*vocabulary_items_pending_image_idx/im,
    /create index vocabulary_items_pending_image_idx[\s\S]*?representation in \(([^)]*)\)/gi,
    "vocabulary_items_pending_image_idx",
  );
}

/** The kinds clear_word_representation leaves an approved picture alone for. */
function kindsInFunction(): readonly string[] {
  return lastList(
    /^\s*create\s+(?:or replace\s+)?function\s+clear_word_representation/im,
    /create (?:or replace )?function clear_word_representation[\s\S]*?p_kind not in \(([^)]*)\)/gi,
    "clear_word_representation",
  );
}

const sorted = (kinds: readonly string[]): readonly string[] =>
  [...kinds].sort();

describe("which kinds are drawn", () => {
  test("the index predicate and isDrawableKind name the same kinds", () => {
    const inTypeScript = enumLabels().filter((kind) => isDrawableKind(kind));
    assert.deepEqual(
      sorted(kindsInIndex()),
      sorted(inTypeScript),
      "vocabulary_items_pending_image_idx and src/lib/images/style.ts disagree about which kinds take a picture",
    );
  });

  test("the function and isDrawableKind name the same kinds", () => {
    const inTypeScript = enumLabels().filter((kind) => isDrawableKind(kind));
    assert.deepEqual(
      sorted(kindsInFunction()),
      sorted(inTypeScript),
      "clear_word_representation and src/lib/images/style.ts disagree about which kinds take a picture",
    );
  });

  /*
   * The two SQL statements are compared to each other as well as to the
   * TypeScript, and not because it follows from the two tests above. It does
   * follow today; it stops following the moment either statement is read by a
   * looser pattern than the other, and this assertion costs one line.
   */
  test("the two SQL statements are spelled the same way", () => {
    assert.deepEqual(kindsInIndex(), kindsInFunction());
  });

  /*
   * There is no test here for "a kind nobody has classified", and that is a
   * finding rather than a gap. One was written on 2026-09-20, asserting that
   * the index and isDrawableKind agree about every label; review probed it
   * with a migration adding a value `diagram` that no list anywhere mentions,
   * and all five tests stayed green. It could not have failed: absence from
   * both sides reads as agreement.
   *
   * Nor should it fail. The three lists are positive, so a value nobody has
   * classified is not drawn by all three of them at once — they agree, and on
   * the safe answer, because the harm runs the other way: a kind wrongly
   * counted as drawable puts a word in a queue asking for a picture nothing
   * can generate. What makes a person look at a new value is
   * representation.test.ts, which refuses an enum label with no Portuguese
   * label on the screen.
   *
   * What is worth checking is the opposite direction, which is not vacuous:
   * SQL naming a kind the enum does not have. That is what a renamed label
   * leaves behind, and Postgres accepts it in an index predicate against an
   * enum column only to fail at the point of use.
   */
  test("names no kind the enum does not have", () => {
    const labels = new Set(enumLabels());
    const strays = [...kindsInIndex(), ...kindsInFunction()].filter(
      (kind) => !labels.has(kind),
    );
    assert.deepEqual(
      strays,
      [],
      `named in SQL and absent from representation_kind: ${strays.join(", ")}`,
    );
  });

  /*
   * Read from the migrations rather than from the generated types, so that a
   * label added to the database is present here on the commit that adds it.
   */
  test("reads the enum from the migrations, and finds the ones added later", () => {
    const labels = enumLabels();
    for (const added of ["pose", "usage", "metalanguage"]) {
      assert.ok(
        labels.includes(added),
        `${added} was added by a migration and this test does not see it`,
      );
    }
  });
});
