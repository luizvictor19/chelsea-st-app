"use client";

import { useEffect } from "react";

import { SCENE_PANEL_ID } from "./filters";
import { takeArrival } from "./arrival";
import {
  WORD_LIST_ID,
  panelBelowList,
  scrollBehaviour,
} from "./panel-into-view";

/**
 * The panel's half of #353: when the panel of the chosen row mounts (each
 * choice remounts it, keyed by its id) and the click marked it, bring the
 * panel's top to the top of the screen again, now that it is the real one.
 * Still only in one column: the same measure as the click.
 */
export function useArrivalScroll(rowId: string): void {
  useEffect(() => {
    if (!takeArrival(rowId)) return;
    const list = document.getElementById(WORD_LIST_ID);
    const panel = document.getElementById(SCENE_PANEL_ID);
    if (list === null || panel === null) return;
    if (
      !panelBelowList(
        list.getBoundingClientRect(),
        panel.getBoundingClientRect(),
      )
    ) {
      return;
    }
    panel.scrollIntoView({
      block: "start",
      behavior: scrollBehaviour(
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    });
  }, [rowId]);
}
