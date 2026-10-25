"use client";

/**
 * Cenas ↓, beside Filtros: brings the Cenas section to the top of the list.
 *
 * Not an anchor. Following `#cenas` scrolls every scrolling ancestor, so the
 * window moved too and the screen's header went off the top. From lg the list
 * is a column that scrolls on its own, and only that column moves here; below
 * lg the page is ordinary flow, and the window is what scrolls.
 */
export function JumpToScenes({ count }: { readonly count: number }) {
  function jump() {
    const section = document.getElementById("cenas");
    if (section === null) return;
    const column = scrollingParent(section);
    const gap = 16;
    if (column === null) {
      window.scrollBy({
        top: section.getBoundingClientRect().top - gap,
        behavior: "smooth",
      });
      return;
    }
    column.scrollBy({
      top:
        section.getBoundingClientRect().top -
        column.getBoundingClientRect().top -
        gap,
      behavior: "smooth",
    });
  }

  return (
    <button
      type="button"
      onClick={jump}
      className="border-rule hover:bg-surface rounded-sm border px-3 py-1.5 text-sm font-semibold transition-colors"
    >
      Cenas ({count}) ↓
    </button>
  );
}

/** The nearest ancestor that scrolls by itself, or null for the window. */
function scrollingParent(element: HTMLElement): HTMLElement | null {
  for (
    let node = element.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
  }
  return null;
}
