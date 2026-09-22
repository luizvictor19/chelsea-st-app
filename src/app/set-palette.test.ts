import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/*
 * The contrast set palette in globals.css, --set-1 to --set-6, read as the
 * browser reads it. setColours hands the colours out in that order and
 * cycles, so two sets that sit next to each other in the list always take
 * consecutive tokens, the 6th next to the 1st included.
 */
const CSS = readFileSync(join(import.meta.dirname, "globals.css"), "utf8");

/*
 * The smallest CIEDE2000 difference allowed between consecutive colours, in
 * either theme.
 *
 * Set from the pair that was seen and rejected on screen on 2026-09-22: teal
 * followed by blue, "too alike" for neighbouring sets. It measures 35.1 in
 * the light theme and 33.5 in the dark one, so the line sits just above it:
 * whatever reads as close as that pair fails here. The palette as reordered
 * measures 35.5 at its weakest (brown back to teal, light theme). Swapping
 * colours for more distance was tried and bought at most 0.6 more, while
 * moving them towards the accent's alarm red, so the colours stayed.
 */
const MIN_NEIGHBOUR_DIFFERENCE = 35;

/* WCAG 1.4.11: a mark that is not text needs 3:1 against what it sits on. */
const MIN_CONTRAST = 3;

type Theme = {
  readonly name: string;
  readonly palette: readonly string[];
  readonly grounds: readonly string[];
};

function tokens(block: string): ReadonlyMap<string, string> {
  return new Map(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [
      m[1],
      m[2].toLowerCase(),
    ]),
  );
}

function theme(name: string, block: string): Theme {
  const values = tokens(block);
  const palette = [1, 2, 3, 4, 5, 6].map((n) => values.get(`set-${n}`));
  const grounds = [values.get("background"), values.get("surface")];
  assert.ok(
    palette.every((v) => v !== undefined) &&
      grounds.every((v) => v !== undefined),
    `${name}: --set-1 to --set-6, --background and --surface are all expected`,
  );
  return {
    name,
    palette: palette as string[],
    grounds: grounds as string[],
  };
}

const light = theme("light", /:root\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "");
const dark = theme(
  "dark",
  /prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(CSS)?.[1] ??
    "",
);

function linear(hex: string): [number, number, number] {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(1), channel(2)];
}

function luminance(hex: string): number {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* sRGB to CIELAB, D65. */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = linear(hex);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => ((((r * 180) / Math.PI) % 360) + 360) % 360;

/* CIEDE2000 (Sharma, Wu and Dalal, 2005), with kL = kC = kH = 1. */
function deltaE2000(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1 = deg(Math.atan2(b1, a1p));
  const h2 = deg(Math.atan2(b2, a2p));

  let dh = 0;
  if (c1p * c2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dL = l2 - l1;
  const dC = c2p - c1p;
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dh / 2));

  const lBar = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBar = h1 + h2;
  if (c1p * c2p !== 0) {
    hBar =
      Math.abs(h1 - h2) <= 180
        ? (h1 + h2) / 2
        : h1 + h2 < 360
          ? (h1 + h2 + 360) / 2
          : (h1 + h2 - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos(rad(hBar - 30)) +
    0.24 * Math.cos(rad(2 * hBar)) +
    0.32 * Math.cos(rad(3 * hBar + 6)) -
    0.2 * Math.cos(rad(4 * hBar - 63));
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT = -Math.sin(rad(2 * dTheta)) * rC;
  return Math.sqrt(
    (dL / sL) ** 2 +
      (dC / sC) ** 2 +
      (dH / sH) ** 2 +
      rT * (dC / sC) * (dH / sH),
  );
}

describe("deltaE2000", () => {
  test("is zero for a colour against itself and symmetric", () => {
    assert.equal(deltaE2000("#0f766e", "#0f766e"), 0);
    assert.equal(
      deltaE2000("#0f766e", "#2563eb").toFixed(6),
      deltaE2000("#2563eb", "#0f766e").toFixed(6),
    );
  });

  test("puts the rejected pair, teal then blue, below the minimum", () => {
    assert.ok(
      Math.min(
        deltaE2000("#0f766e", "#2563eb"),
        deltaE2000("#2dd4bf", "#60a5fa"),
      ) < MIN_NEIGHBOUR_DIFFERENCE,
    );
  });
});

describe("the contrast set palette", () => {
  for (const { name, palette, grounds } of [light, dark]) {
    test(`${name}: consecutive colours differ enough, the 6th to the 1st included`, () => {
      const weak = palette
        .map((colour, i) => {
          const next = palette[(i + 1) % palette.length];
          return {
            pair: `--set-${i + 1} ${colour} -> --set-${((i + 1) % palette.length) + 1} ${next}`,
            difference: deltaE2000(colour, next),
          };
        })
        .filter((p) => p.difference < MIN_NEIGHBOUR_DIFFERENCE);
      assert.deepEqual(
        weak.map((p) => `${p.pair}: ${p.difference.toFixed(1)}`),
        [],
      );
    });

    test(`${name}: every colour stands out from the background and the surface`, () => {
      const faint = palette.flatMap((colour, i) =>
        grounds
          .map((ground) => ({ ground, ratio: contrast(colour, ground) }))
          .filter((c) => c.ratio < MIN_CONTRAST)
          .map(
            (c) =>
              `--set-${i + 1} ${colour} on ${c.ground}: ${c.ratio.toFixed(2)}`,
          ),
      );
      assert.deepEqual(faint, []);
    });
  }
});
