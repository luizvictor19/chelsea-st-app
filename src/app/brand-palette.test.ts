import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { BRAND_KEYS } from "../lib/brand.ts";

/*
 * The accent of each brand in globals.css, read as the browser reads it: the
 * default tokens of :root, with :root[data-brand="…"] on top for a brand that
 * has its own (#195).
 *
 * The accent fills the main buttons, with --accent-foreground written on it,
 * and is itself the colour of alert text on the page and on a form's surface.
 * All three pairs are text, so all three are held to WCAG 1.4.3.
 */
const CSS = readFileSync(join(import.meta.dirname, "globals.css"), "utf8");

const MIN_TEXT_CONTRAST = 4.5;

/** The tokens a brand may change. Ground and surface stay: the mascot art is painted on them. */
const BRAND_TOKENS = ["accent", "accent-foreground"];

/** The brand the default tokens are, with no data-brand block of its own. */
const DEFAULT_BRAND = "chelsea-st";

function tokens(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [
      m[1],
      m[2].toLowerCase(),
    ]),
  );
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What opens a rule of the dark theme, right before its selector. */
const DARK = String.raw`prefers-color-scheme:\s*dark\)\s*\{\s*`;

/** The declarations of a selector, in the dark theme or out of it. */
function block(selector: string, dark: boolean): string | null {
  const where = dark ? `(?<=${DARK})` : `(?<!${DARK})`;
  const pattern = new RegExp(`${where}${escape(selector)}\\s*\\{([^}]*)\\}`);
  return pattern.exec(CSS)?.[1] ?? null;
}

function palette(brand: string, dark: boolean): Map<string, string> {
  const base = tokens(block(":root", dark) ?? "");
  if (brand === DEFAULT_BRAND) {
    return base;
  }
  const own = block(`:root[data-brand="${brand}"]`, dark);
  assert.ok(own !== null, `${brand} has no ${dark ? "dark" : "light"} block`);
  return new Map([...base, ...tokens(own)]);
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("the brand palette", () => {
  for (const brand of BRAND_KEYS) {
    for (const dark of [false, true]) {
      const name = `${brand} ${dark ? "dark" : "light"}`;
      const colour = (token: string) => {
        const value = palette(brand, dark).get(token);
        assert.ok(value !== undefined, `${name}: --${token} is expected`);
        return value;
      };

      test(`${name}: the accent reads on the ground and on the surface`, () => {
        for (const ground of ["background", "surface"]) {
          const ratio = contrast(colour("accent"), colour(ground));
          assert.ok(
            ratio >= MIN_TEXT_CONTRAST,
            `${name} on ${ground}: ${ratio.toFixed(2)}`,
          );
        }
      });

      test(`${name}: the text on the accent reads`, () => {
        const ratio = contrast(colour("accent-foreground"), colour("accent"));
        assert.ok(ratio >= MIN_TEXT_CONTRAST, `${name}: ${ratio.toFixed(2)}`);
      });
    }

    if (brand !== DEFAULT_BRAND) {
      test(`${brand} changes the accent only`, () => {
        for (const dark of [false, true]) {
          const own = tokens(block(`:root[data-brand="${brand}"]`, dark) ?? "");
          assert.deepEqual([...own.keys()].sort(), [...BRAND_TOKENS].sort());
        }
      });
    }
  }

  test("the dark theme still finds its default tokens", () => {
    assert.equal(palette(DEFAULT_BRAND, true).get("background"), "#0f1115");
    assert.equal(palette(DEFAULT_BRAND, false).get("background"), "#f2f2f0");
  });
});
