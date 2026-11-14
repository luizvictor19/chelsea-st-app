import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * scripts/gen-types.sh runs scripts/verify-rls.sql inside a throwaway
 * container, and psql inside that container sees only what the script copied
 * in. Every `\i` in verify-rls.sql is therefore a file the script must copy,
 * and nothing ties the two together but this test.
 *
 * It was not held before #300: verify-rls.sql gained
 * `\i scripts/restore-outside-public.sql` (#104), the script went on copying
 * verify-rls.sql alone, and psql stopped halfway with no types written.
 *
 * The includes under supabase/migrations are held the same way as any other:
 * the script copies that directory whole, and a copy of a containing
 * directory counts as a copy of each file in it.
 */
const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "gen-types.sh");
const ENTRY = "scripts/verify-rls.sql";

/** The paths a psql file pulls in with `\i` or `\include`, as written. */
function includesOf(path: string): string[] {
  const sql = readFileSync(join(ROOT, path), "utf8");
  return [...sql.matchAll(/^[ \t]*\\i(?:nclude)?[ \t]+(\S+)/gmu)].map(
    (match) => match[1],
  );
}

/** Every file psql reads when it runs the entry file, entry included. */
function filesPsqlReads(): string[] {
  const seen = new Set<string>();
  const pending = [ENTRY];
  while (pending.length > 0) {
    const path = pending.pop() as string;
    if (seen.has(path)) continue;
    seen.add(path);
    pending.push(...includesOf(path));
  }
  return [...seen];
}

/** The host side of each `docker cp` in the script: what reaches the container. */
function copiedIntoTheContainer(): string[] {
  const script = readFileSync(SCRIPT, "utf8");
  return [...script.matchAll(/^[ \t]*docker cp[ \t]+(\S+)[ \t]+\S+/gmu)].map(
    (match) => match[1].replace(/\/+$/u, ""),
  );
}

function isCopied(path: string, copies: string[]): boolean {
  return copies.some((copy) => path === copy || path.startsWith(`${copy}/`));
}

describe("scripts/gen-types.sh", () => {
  test("copies into the container every file verify-rls.sql includes", () => {
    const copies = copiedIntoTheContainer();
    const missing = filesPsqlReads().filter((path) => !isCopied(path, copies));
    assert.deepEqual(missing, [], "files psql would not find in the container");
  });

  /*
   * The test above only reads text. A path it accepts must also exist, or an
   * include renamed in the SQL and not on disk would pass here and fail in
   * the container.
   */
  test("names includes that exist in the repository", () => {
    const absent = filesPsqlReads().filter(
      (path) => !existsSync(join(ROOT, path)),
    );
    assert.deepEqual(absent, []);
  });

  /*
   * Held so the parsing above cannot pass by finding nothing: the include
   * that broke the script in #300 has to be among the files read.
   */
  test("sees the include that broke it in #300", () => {
    assert.ok(filesPsqlReads().includes("scripts/restore-outside-public.sql"));
  });
});
