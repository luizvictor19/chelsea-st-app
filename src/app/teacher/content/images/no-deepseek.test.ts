import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

/**
 * DeepSeek left the app on 2026-11-06 (#225): the three content suggestions
 * call Claude. src/lib/text/deepseek.ts stays, for the measurement scripts
 * that compare against the old numbers, and DEEPSEEK_API_KEY stays in Vercel
 * by Luiz's decision, so a way back exists. This is what keeps the way back
 * an issue rather than an import: no file of src/ reaches deepseek.ts.
 */

const SRC = join(import.meta.dirname, "../../../..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

/** An import or export specifier that names the DeepSeek module. */
const DEEPSEEK = /from\s+["'][^"']*\btext\/deepseek(\.ts)?["']/u;

test("no file of src/ imports the DeepSeek provider", () => {
  const files = sources(SRC).filter(
    (path) => !path.endsWith("deepseek.ts") && path !== import.meta.filename,
  );
  assert.ok(files.length > 100, "the walk found the sources");
  const importers = files
    .filter((path) => DEEPSEEK.test(readFileSync(path, "utf8")))
    .map((path) => relative(SRC, path));
  assert.deepEqual(importers, []);
});

test("the pattern sees the forms an import takes", () => {
  for (const line of [
    `import { createDeepSeekProvider } from "@/lib/text/deepseek";`,
    `import { createDeepSeekProvider } from "../../../../lib/text/deepseek.ts";`,
    `export { createDeepSeekProvider } from '@/lib/text/deepseek';`,
  ]) {
    assert.match(line, DEEPSEEK);
  }
  assert.doesNotMatch(`import { usdFor } from "@/lib/text/cost";`, DEEPSEEK);
});
