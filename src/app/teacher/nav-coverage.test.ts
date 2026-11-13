import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, test } from "node:test";

import { teacherLinks } from "./nav-links.ts";

/**
 * Every screen of /teacher has an item in the menu (#316): before it,
 * /teacher/plans was reachable only by typing its address. This walks the
 * pages on disk, so a new screen without an item fails here, not on the day
 * someone looks for it.
 */

const TEACHER = import.meta.dirname;

/**
 * The screens left out of the menu on purpose, each with why. Neither is the
 * teacher's work, and a teacher who is not the platform admin would see
 * prototypes in her menu. They stay reachable by address.
 */
const OFF_MENU: ReadonlyMap<string, string> = new Map([
  [
    "/teacher/audio-test",
    "a scratch page that measures what this device's recording produces, and in development records the STT cases of scripts/measure-stt.ts",
  ],
  [
    "/teacher/session-preview",
    "the prototype of Robin's session screen over a fake turn, kept under /teacher so no student lands on it",
  ],
]);

/**
 * The route of every page.tsx under a directory. A dynamic segment ([book],
 * [id]) is a screen reached from its list, never from the menu, so it is
 * skipped; a route group ((name)) adds nothing to the path.
 */
function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name.startsWith("[") ? [] : routes(path);
    }
    if (entry.name !== "page.tsx") return [];
    const segments = relative(TEACHER, dir)
      .split(sep)
      .filter((segment) => segment !== "" && !/^\(.*\)$/u.test(segment));
    return [["/teacher", ...segments].join("/")];
  });
}

const pages = routes(TEACHER);
const menu = new Set(
  teacherLinks(true).flatMap(({ href }) => (href === null ? [] : [href])),
);

describe("the teacher menu covers every screen", () => {
  test("the walk found the screens", () => {
    assert.ok(pages.includes("/teacher"));
    assert.ok(pages.includes("/teacher/content/images"));
    assert.ok(pages.length >= 10, `found ${pages.length}`);
  });

  test("every page has an item, or a reason to have none", () => {
    const missing = pages.filter(
      (route) => !menu.has(route) && !OFF_MENU.has(route),
    );
    assert.deepEqual(missing, [], "add an item to nav-links.ts or a reason");
  });

  test("every item opens a page", () => {
    const dead = [...menu].filter((href) => !pages.includes(href));
    assert.deepEqual(dead, []);
  });

  test("every screen left out still exists and is not in the menu", () => {
    for (const route of OFF_MENU.keys()) {
      assert.ok(
        existsSync(join(TEACHER, route.slice("/teacher/".length), "page.tsx")),
        `${route} is gone: drop it from OFF_MENU`,
      );
      assert.ok(!menu.has(route), `${route} has an item now`);
    }
  });
});
