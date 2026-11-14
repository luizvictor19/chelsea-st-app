/**
 * The classes of a word's or a scene's row in the list (#351). The chosen
 * row keeps the surface background it had and gains an outline in the accent
 * colour, which the theme sets for both brands and the dark mode: the rule
 * colour alone looked like every other border on the page.
 *
 * The inset ring doubles the border on the inside, so the row keeps its
 * height and the list column's overflow cannot clip the outline.
 *
 * A plain module and not the client PanelLink: a constant exported from a
 * "use client" file reaches a server component as a reference, not a string.
 */

const ROW =
  "flex min-w-0 flex-1 items-center justify-between gap-3 rounded-sm border px-3 py-2";

export function rowClass(chosen: boolean): string {
  return chosen
    ? `${ROW} bg-surface border-accent inset-ring inset-ring-accent`
    : `${ROW} border-transparent hover:bg-surface transition-colors`;
}
