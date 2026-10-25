import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { RENAMED_PATHS } from "./renamed-paths.ts";

describe("RENAMED_PATHS", () => {
  test("every new path is a page of the app", () => {
    for (const { to } of RENAMED_PATHS) {
      assert.ok(
        existsSync(join("src/app", to, "page.tsx")),
        `${to} has no page.tsx`,
      );
    }
  });

  test("no old path is still a page, and none is a destination", () => {
    const old = new Set(RENAMED_PATHS.map(({ from }) => from));
    for (const { from, to } of RENAMED_PATHS) {
      assert.ok(
        !existsSync(join("src/app", from, "page.tsx")),
        `${from} still has a page.tsx`,
      );
      assert.ok(!old.has(to), `${to} redirects again`);
    }
  });
});
