/**
 * Which page of an upload the review is looking at, and where it goes next.
 *
 * Pulled out of the screen so the rules can be tested. The review used to be
 * one page forty-eight thousand pixels tall, scrolled to find where you were;
 * with a rail and one page at a time, "where you were" becomes state, and state
 * that loses a draft or confirms the wrong page is the expensive kind.
 */

/** What the rail shows against a page, and what the work column may do with it. */
export type PageState =
  | "needs-answer"
  | "waiting"
  | "saved"
  | "duplicate"
  | "unsupported"
  | "refused";

export type ReviewPage = {
  readonly id: string;
  readonly state: PageState;
};

/** States a page can be worked on in. The rest are shown but not visited. */
const ACTIONABLE: ReadonlySet<PageState> = new Set<PageState>([
  "needs-answer",
  "waiting",
]);

export function isActionable(state: PageState): boolean {
  return ACTIONABLE.has(state);
}

/**
 * The page to open when the review is first shown, or after a batch is
 * restored.
 *
 * The one that needs an answer comes first, because it is the only kind that
 * blocks: a page whose point the batch could not settle cannot be written at
 * all until someone says which point it is. Then the first page still waiting.
 * If everything is done, the first page of all, so the screen is never blank.
 */
export function initialFocus(pages: readonly ReviewPage[]): string | null {
  if (pages.length === 0) {
    return null;
  }
  const blocked = pages.find((page) => page.state === "needs-answer");
  if (blocked !== undefined) {
    return blocked.id;
  }
  const waiting = pages.find((page) => page.state === "waiting");
  return (waiting ?? pages[0]).id;
}

/**
 * Where to go after finishing with a page.
 *
 * Forward from where you are, then wrapping to the start, so confirming the
 * last page still lands on whatever was skipped earlier rather than on nothing.
 * Only pages that can be worked on are offered; a re-upload or a refused image
 * is never somewhere to be sent.
 *
 * Returns null when nothing is left, which is what tells the screen the batch
 * is done.
 */
export function nextAfter(
  pages: readonly ReviewPage[],
  currentId: string,
): string | null {
  const index = pages.findIndex((page) => page.id === currentId);
  if (index < 0) {
    return initialFocus(pages.filter((page) => isActionable(page.state)));
  }

  const ordered = [...pages.slice(index + 1), ...pages.slice(0, index)];
  const next = ordered.find((page) => isActionable(page.state));
  return next?.id ?? null;
}

/**
 * The page the screen should show, given what it was showing before.
 *
 * Keeps the current page when it still exists, because a rail that moves under
 * the teacher after every save is worse than one that stays put. Only falls
 * back when the page is gone.
 */
export function resolveFocus(
  pages: readonly ReviewPage[],
  currentId: string | null,
): string | null {
  if (currentId !== null && pages.some((page) => page.id === currentId)) {
    return currentId;
  }
  return initialFocus(pages);
}

export type BatchProgress = {
  readonly total: number;
  readonly saved: number;
  readonly needingAnswer: number;
  readonly fraction: number;
};

/**
 * The counts above the rail.
 *
 * Over pages that can be written, so a re-upload and a refused image do not
 * make the batch look permanently unfinished.
 */
export function batchProgress(pages: readonly ReviewPage[]): BatchProgress {
  const relevant = pages.filter(
    (page) => isActionable(page.state) || page.state === "saved",
  );
  const saved = relevant.filter((page) => page.state === "saved").length;
  return {
    total: relevant.length,
    saved,
    needingAnswer: pages.filter((page) => page.state === "needs-answer").length,
    fraction: relevant.length === 0 ? 0 : saved / relevant.length,
  };
}
