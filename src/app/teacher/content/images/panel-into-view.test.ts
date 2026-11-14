import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { panelBelowList, scrollBehaviour } from "./panel-into-view.ts";

/*
 * The geometry of the screen as the stylesheet draws it, and not round
 * numbers: the teacher nav is w-56 (224px), main has px-8 (32px a side), the
 * scrollbar takes about 15px, and from lg the grid is minmax(0,1fr) beside
 * 26rem (416px) with gap-8 (32px) between them.
 */
describe("panelBelowList", () => {
  /*
   * Luiz's window on 14/11, about 865px wide: below lg, so one column. The
   * content runs from 224 + 32 = 256 to 865 - 15 - 32 = 818, and the list
   * and the panel both take all of it.
   */
  test("one column at 865px: the panel is below the list", () => {
    const list = { left: 256, right: 818 };
    const panel = { left: 256, right: 818 };
    assert.equal(panelBelowList(list, panel), true);
  });

  /*
   * 1440px: the content runs from 256 to 1393, 1137px. The panel is the last
   * 416px of it, the list the 689px before the gap.
   */
  test("two columns at 1440px: the panel is beside the list", () => {
    const list = { left: 256, right: 945 };
    const panel = { left: 977, right: 1393 };
    assert.equal(panelBelowList(list, panel), false);
  });

  /*
   * lg itself, 1024px, is the narrowest two columns get, and the gap is still
   * the whole 32px: content 256 to 977, panel 561 to 977, list 256 to 529.
   */
  test("two columns at the narrowest, 1024px: still beside", () => {
    const list = { left: 256, right: 529 };
    const panel = { left: 561, right: 977 };
    assert.equal(panelBelowList(list, panel), false);
  });

  /* Fractional pixels from zoom do not tip one column over into two. */
  test("one column with fractional edges is still one column", () => {
    const list = { left: 256.4, right: 817.6 };
    const panel = { left: 256.4, right: 817.6 };
    assert.equal(panelBelowList(list, panel), true);
  });
});

describe("scrollBehaviour", () => {
  test("smooth by default", () => {
    assert.equal(scrollBehaviour(false), "smooth");
  });

  test("no animation when the system asks for reduced motion", () => {
    assert.equal(scrollBehaviour(true), "auto");
  });
});
