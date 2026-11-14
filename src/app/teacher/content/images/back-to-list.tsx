"use client";

import { WORD_LIST_ID, scrollBehaviour } from "./panel-into-view";

/**
 * "Voltar à lista" on the panel (#351): in one column the panel sits after
 * the whole list, and choosing a word or a scene scrolls down to it (#341,
 * #343). This takes the window back to the chosen row, in the middle of the
 * screen so the sticky nav never covers it and its neighbours show, and puts
 * the focus on it so the keyboard carries on from there.
 *
 * lg:hidden is the same breakpoint that puts the list beside the panel, so
 * the two change together: side by side the list is already in view.
 *
 * A row the filter no longer shows has no element: the list's top instead.
 */
export function BackToList({ rowId }: { readonly rowId: string }) {
  function back() {
    const target =
      document.getElementById(rowId) ?? document.getElementById(WORD_LIST_ID);
    if (target === null) return;
    target.scrollIntoView({
      block: target.id === rowId ? "center" : "start",
      behavior: scrollBehaviour(
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    });
    target.focus({ preventScroll: true });
  }

  return (
    <button
      type="button"
      onClick={back}
      className="text-muted hover:text-foreground self-start text-sm underline underline-offset-2 lg:hidden"
    >
      ↑ Voltar à lista
    </button>
  );
}
