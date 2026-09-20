import type { Representation } from "@/lib/content/queries";

/**
 * Every kind, in the order the buttons show them.
 *
 * This list cannot be derived from the enum, because the labels are Portuguese
 * and the database has no opinion about Portuguese. What can be checked is
 * that it covers the enum, and representation.test.ts does exactly that: a
 * kind added to the database and not to this list turns a test red instead of
 * leaving a gap on the screen where a button should be.
 */
export const REPRESENTATIONS = [
  { kind: "photo", label: "Foto" },
  { kind: "pose", label: "Postura" },
  { kind: "action", label: "Ação" },
  { kind: "figure", label: "Figura" },
  { kind: "symbol", label: "Símbolo" },
  { kind: "usage", label: "Uso" },
  { kind: "metalanguage", label: "Metalinguagem" },
  { kind: "none", label: "Nada" },
] as const satisfies readonly { kind: Representation; label: string }[];

export function labelFor(kind: Representation | null): string {
  if (kind === null) return "sem decidir";
  return REPRESENTATIONS.find((item) => item.kind === kind)?.label ?? kind;
}

/**
 * The suggestion a decided word disagrees with, or null when there is nothing
 * to show.
 *
 * Null in three cases: no suggestion, no decision, or the two agreeing. The
 * undecided word is handled by the proposal states instead, and agreement is
 * not worth screen space, so what is left is exactly the disagreements. That
 * turns a decided lesson into a visible list of where the model and the
 * teacher differ, which until now only came out of a SQL query.
 */
export function disagreement(
  representation: Representation | null,
  suggested: Representation | null,
): Representation | null {
  if (representation === null || suggested === null) return null;
  return representation === suggested ? null : suggested;
}
