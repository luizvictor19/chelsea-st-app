import type { Situation } from "./filters";

/**
 * The tick, the waiting circle, or nothing. Moved out of page.tsx unchanged,
 * so a scene's row (#64) shows its state with the same mark as a word's.
 */
export function StatusMark({ situation }: { readonly situation: Situation }) {
  if (situation === "com-imagem") {
    return (
      <svg
        viewBox="0 0 16 16"
        className="text-foreground size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="img"
        aria-label="com imagem"
      >
        <path d="M3 8.5l3.5 3.5L13 4.5" />
      </svg>
    );
  }
  if (situation === "sem-imagem") {
    return (
      <svg
        viewBox="0 0 16 16"
        className="text-faint size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2.5 2"
        role="img"
        aria-label="sem imagem ainda"
      >
        <circle cx="8" cy="8" r="5.25" />
      </svg>
    );
  }
  return <span className="size-3.5" aria-hidden="true" />;
}
