import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { BRAND_KEYS } from "./brand.ts";

/*
 * The brands the database accepts and the brands this code knows are two
 * lists written by hand: the check organizations_brand_known (0041) and
 * BRAND_KEYS in brand.ts. A brand added to one alone drifts in silence: an
 * organization the code cannot dress, or a brand no organization can wear.
 *
 * The list read is the check's latest definition across the migrations, so a
 * migration that adds a brand later is what this compares against.
 */
const MIGRATIONS = join(
  import.meta.dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);

const CHECK =
  /organizations_brand_known\s+check\s*\(\s*brand\s+in\s*\(([^)]*)\)\s*\)/;

/**
 * Every mention of the constraint across the migrations, in order, each with
 * the list it defines, or null when it is not a definition this test can read
 * (a drop, or a check written in another form).
 */
function mentions(): { file: string; brands: string[] | null }[] {
  const found: { file: string; brands: string[] | null }[] = [];
  for (const file of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const match of sql.matchAll(/organizations_brand_known/g)) {
      const defined = new RegExp(CHECK.source, "iy");
      defined.lastIndex = match.index;
      const list = defined.exec(sql)?.[1];
      found.push({
        file,
        brands:
          list === undefined
            ? null
            : [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]),
      });
    }
  }
  return found;
}

describe("the brand keys", () => {
  test("are exactly the ones organizations_brand_known accepts", () => {
    const found = mentions();
    assert.ok(found.length > 0, "organizations_brand_known not found");
    const latest = found[found.length - 1].brands;
    assert.ok(latest !== null, "the latest mention is not a definition");
    assert.deepEqual([...latest].sort(), [...BRAND_KEYS].sort());
  });

  /*
   * A drop, or a check rewritten in another form (= any (array[...])), would
   * leave the test above reading an older list. Every mention has to be a
   * definition it reads; a migration that changes the check another way
   * changes this test with it.
   */
  test("every mention of the constraint is a definition this test reads", () => {
    const unread = mentions()
      .filter((m) => m.brands === null)
      .map((m) => m.file);
    assert.deepEqual(unread, []);
  });
});
