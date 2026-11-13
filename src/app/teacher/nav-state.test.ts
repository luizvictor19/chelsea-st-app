import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isCollapsed, NAV_COOKIE, navCookie } from "./nav-state.ts";

/** The value navCookie writes, as the browser sends it back. */
function valueOf(cookie: string): string {
  const [pair] = cookie.split("; ");
  const [name, value] = pair.split("=");
  assert.equal(name, NAV_COOKIE);
  return value;
}

describe("isCollapsed", () => {
  test("only the collapsed value minimizes the menu", () => {
    assert.equal(isCollapsed("collapsed"), true);
    assert.equal(isCollapsed("expanded"), false);
  });

  test("no cookie, or one this code does not know, is the full menu", () => {
    assert.equal(isCollapsed(undefined), false);
    assert.equal(isCollapsed(""), false);
    assert.equal(isCollapsed("Collapsed"), false);
    assert.equal(isCollapsed("true"), false);
  });
});

describe("navCookie", () => {
  test("what it writes reads back as the same state", () => {
    for (const collapsed of [true, false]) {
      assert.equal(isCollapsed(valueOf(navCookie(collapsed))), collapsed);
    }
  });

  test("it lives under /teacher for a year", () => {
    const attributes = navCookie(true).split("; ").slice(1);
    assert.deepEqual(attributes, [
      "Path=/teacher",
      "Max-Age=31536000",
      "SameSite=Lax",
    ]);
  });
});
