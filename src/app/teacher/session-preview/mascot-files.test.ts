import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { CHELSEA, GRIFOAI } from "../../../lib/brand.ts";
import { mascotFiles } from "./mascot-art.ts";

/*
 * A missing file is a blank square on the session screen, under one brand
 * only, and nothing fails until someone opens that host. So every file the
 * tutor's states ask for is checked here, for every brand.
 */
const PUBLIC = join(import.meta.dirname, "..", "..", "..", "..", "public");

describe("the mascot art", () => {
  for (const brand of [CHELSEA, GRIFOAI]) {
    test(`${brand.name}: every file the tutor shows exists in public/`, () => {
      const missing = mascotFiles(brand.mascot).filter(
        (url) => !existsSync(join(PUBLIC, url)),
      );
      assert.deepEqual(missing, []);
    });
  }

  test("Robin's six files are the ones named", () => {
    assert.deepEqual(mascotFiles(CHELSEA.mascot), [
      "/robin/robin-idle-dark.mp4",
      "/robin/robin-idle-dark.png",
      "/robin/robin-idle-light.mp4",
      "/robin/robin-idle-light.png",
      "/robin/robin-listening-dark.png",
      "/robin/robin-listening-light.png",
    ]);
  });
});
