import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/*
 * The usage bands in globals.css, --usage-none to --usage-high, read as the
 * browser reads them. Each fills the pill behind a word's count, and the
 * count is written in --background, so that pair is held to text contrast.
 * The pill itself sits on the page or on a form's surface.
 */
const CSS = readFileSync(join(import.meta.dirname, "globals.css"), "utf8");

const BANDS = ["none", "low", "medium", "high"];

/* WCAG 1.4.3 for the number, 1.4.11 for the pill against what it sits on. */
const MIN_TEXT_CONTRAST = 4.5;
const MIN_MARK_CONTRAST = 3;

function tokens(block: string): ReadonlyMap<string, string> {
  return new Map(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [
      m[1],
      m[2].toLowerCase(),
    ]),
  );
}

const themes = [
  { name: "light", block: /:root\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "" },
  {
    name: "dark",
    block:
      /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(
        CSS,
      )?.[1] ?? "",
  },
].map(({ name, block }) => ({ name, values: tokens(block) }));

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

describe("the usage palette", () => {
  for (const { name, values } of themes) {
    const colour = (token: string) => {
      const value = values.get(token);
      assert.ok(value !== undefined, `${name}: --${token} is expected`);
      return value;
    };

    test(`${name}: the count reads on every band`, () => {
      for (const band of BANDS) {
        const ratio = contrast(colour(`usage-${band}`), colour("background"));
        assert.ok(
          ratio >= MIN_TEXT_CONTRAST,
          `${name} ${band}: ${ratio.toFixed(2)}`,
        );
      }
    });

    test(`${name}: every band stands out from a form's surface`, () => {
      for (const band of BANDS) {
        const ratio = contrast(colour(`usage-${band}`), colour("surface"));
        assert.ok(
          ratio >= MIN_MARK_CONTRAST,
          `${name} ${band}: ${ratio.toFixed(2)}`,
        );
      }
    });

    test(`${name}: no two bands share a colour`, () => {
      const colours = BANDS.map((band) => colour(`usage-${band}`));
      assert.equal(new Set(colours).size, BANDS.length);
    });
  }
});
