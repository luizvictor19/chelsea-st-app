"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";

import { SCENE_PANEL_ID } from "./filters";
import {
  WORD_LIST_ID,
  panelBelowList,
  scrollBehaviour,
} from "./panel-into-view";

/**
 * A word's or a scene's row in the list: the same Link as before, plus the
 * scroll to the panel when the panel sits below the list (#341, #343). Both
 * open the one panel, and the scenes sit in the list's column under the
 * lessons, so the same measure decides for both.
 *
 * The scroll happens at the click and not when the new panel arrives. The
 * panel's box is on the page already (the previous word or scene, or the line
 * that says to choose one), its top depends only on the list above it, and
 * the list does not move when a row is chosen, so the place is known now and
 * the teacher sees the screen move at once rather than after the server
 * answers.
 *
 * scroll={false} so Next leaves the window alone. Its default puts the
 * window back at the top of the page when the page's top edge is out of
 * view, which after this scroll it is, and the panel would be lost again.
 */
export function PanelLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  function intoView(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    // A click that opens a new tab, or one something else already handled,
    // leaves this window where it is.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
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
  }

  return <Link {...props} scroll={false} onClick={intoView} />;
}
