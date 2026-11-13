import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  AUDIENCE_LABEL,
  BADGE_KEYS,
  BADGE_LABEL,
  BADGE_SOURCE_LABEL,
  BADGE_SOURCES,
  founderLine,
  founderSince,
  isBadgeSource,
  isPlanAudience,
  PLAN_AUDIENCES,
} from "./badges.ts";

/*
 * The seals, their sources and the audiences of a plan are lists written
 * twice: in the checks of 0058 and in badges.ts. Each is read here from the
 * latest definition of its check across the migrations, so a migration that
 * adds a value later is what this compares against.
 */
const MIGRATIONS = join(
  import.meta.dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);

function latestList(constraint: string, column: string): string[] {
  const check = new RegExp(
    `${constraint}\\s+check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)\\s*\\)`,
    "i",
  );
  let latest: string[] | null = null;
  for (const file of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const list = check.exec(readFileSync(join(MIGRATIONS, file), "utf8"))?.[1];
    if (list !== undefined) {
      latest = [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    }
  }
  assert.ok(latest !== null, `${constraint} not found in the migrations`);
  return latest;
}

describe("the lists of 0058", () => {
  test("BADGE_KEYS is person_badges_badge_known", () => {
    assert.deepEqual(
      [...BADGE_KEYS].sort(),
      latestList("person_badges_badge_known", "badge").sort(),
    );
  });

  test("BADGE_SOURCES is person_badges_source_known", () => {
    assert.deepEqual(
      [...BADGE_SOURCES].sort(),
      latestList("person_badges_source_known", "source").sort(),
    );
  });

  test("PLAN_AUDIENCES is plans_audience_known", () => {
    assert.deepEqual(
      [...PLAN_AUDIENCES].sort(),
      latestList("plans_audience_known", "audience").sort(),
    );
  });

  test("the guards know the lists and nothing else", () => {
    assert.equal(isBadgeSource("coupon"), true);
    assert.equal(isBadgeSource("gift"), false);
    assert.equal(isPlanAudience("founder"), true);
    assert.equal(isPlanAudience(null), false);
  });

  test("every value has its label", () => {
    for (const key of BADGE_KEYS) assert.ok(BADGE_LABEL[key]);
    for (const source of BADGE_SOURCES) assert.ok(BADGE_SOURCE_LABEL[source]);
    for (const audience of PLAN_AUDIENCES) assert.ok(AUDIENCE_LABEL[audience]);
  });
});

describe("founderLine", () => {
  test("the day of the seal in São Paulo, near midnight", () => {
    // 02:30 UTC on the 14th is still the 13th in São Paulo.
    assert.equal(
      founderSince("2026-11-14T02:30:00Z"),
      "Selo de fundador · desde 13/11/2026",
    );
    assert.equal(
      founderSince("2026-11-14T03:30:00Z"),
      "Selo de fundador · desde 14/11/2026",
    );
  });

  test("says the founder may stay or come back, with no number", () => {
    const line = founderLine("2026-11-14T12:00:00Z");
    assert.match(line, /^Selo de fundador · desde 14\/11\/2026\. /);
    assert.match(line, /Plano Fundador/);
    assert.doesNotMatch(line.replace(/\d{2}\/\d{2}\/\d{4}/, ""), /\d/);
  });
});
