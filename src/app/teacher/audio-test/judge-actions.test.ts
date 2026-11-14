import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The judge's action pays for a call, so who calls it is checked before the
 * form is read and before the judge is built: the same order
 * content/images/paid-after-guard.test.ts holds for the content actions.
 * actions-guard.test.ts holds that the guard is requirePlatformAdmin.
 */

const source = readFileSync(
  join(import.meta.dirname, "judge-actions.ts"),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/\/\/.*$/gmu, "");

const body = source.slice(
  source.indexOf("export async function judgeSpokenAnswer"),
);

test("the platform admin is checked before anything is read or paid", () => {
  const guard = body.indexOf("await requirePlatformAdmin()");
  assert.ok(guard >= 0, "no guard");
  for (const later of ["form.get(", "appJudge(", "judgeAnswer("]) {
    const at = body.indexOf(later);
    assert.ok(at > guard, `${later} before the guard`);
  }
});

test("the action stores nothing", () => {
  assert.ok(!/\bfrom\(|\.rpc\(|\.storage\b|writeFile/u.test(source));
});
