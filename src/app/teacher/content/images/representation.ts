import type { Representation } from "@/lib/content/queries";

/** The five kinds, in the order the buttons show them. */
export const REPRESENTATIONS = [
  { kind: "photo", label: "Foto" },
  { kind: "symbol", label: "Símbolo" },
  { kind: "figure", label: "Figura" },
  { kind: "action", label: "Ação" },
  { kind: "none", label: "Nada" },
] as const satisfies readonly { kind: Representation; label: string }[];

/** The filter keys the screen puts in the query string, in Portuguese. */
export const FILTERS = [
  { key: "todas", label: "Todas" },
  { key: "sem-decidir", label: "Sem decidir" },
  ...REPRESENTATIONS.map(({ kind, label }) => ({ key: kind, label })),
] as const;

export function labelFor(kind: Representation | null): string {
  if (kind === null) return "sem decidir";
  return REPRESENTATIONS.find((item) => item.kind === kind)?.label ?? kind;
}

/** Whether a word belongs in the list under the given filter key. */
export function matchesFilter(
  filter: string,
  representation: Representation | null,
): boolean {
  if (filter === "todas") return true;
  if (filter === "sem-decidir") return representation === null;
  return representation === filter;
}
