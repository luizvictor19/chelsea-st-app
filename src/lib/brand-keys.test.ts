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
  /organizations_brand_known\s+check\s*\(\s*brand\s+in\s*\(([^)]*)\)\s*\)/gi;

function brandsInTheDatabase(): string[] | null {
  let latest: string | null = null;
  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    for (const match of readFileSync(join(MIGRATIONS, name), "utf8").matchAll(
      CHECK,
    )) {
      latest = match[1];
    }
  }
  if (latest === null) {
    return null;
  }
  return [...latest.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

describe("the brand keys", () => {
  test("are exactly the ones organizations_brand_known accepts", () => {
    const accepted = brandsInTheDatabase();
    assert.ok(
      accepted !== null,
      "organizations_brand_known not found in the migrations",
    );
    assert.deepEqual([...accepted].sort(), [...BRAND_KEYS].sort());
  });
});
