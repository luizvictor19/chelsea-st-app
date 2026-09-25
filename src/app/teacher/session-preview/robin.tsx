export type RobinState = "idle" | "listening" | "thinking" | "speaking";

const LABELS: Record<RobinState, string> = {
  idle: "parado",
  listening: "ouvindo",
  thinking: "pensando",
  speaking: "falando",
};

/**
 * PLACEHOLDER: the Robin art is not in the repository yet. This stands in for
 * it, clearly marked, so the four states can be seen and timed on the screen.
 * The real art replaces the body of this component, one file per state under
 * public/robin/ (robin-idle, robin-listening, robin-thinking, robin-speaking),
 * and the props stay as they are.
 */
export function Robin({ state }: { readonly state: RobinState }) {
  return (
    <div
      data-placeholder="robin"
      role="img"
      aria-label={`Robin, ${LABELS[state]}`}
      className="border-faint relative flex size-24 shrink-0 flex-col items-center justify-center rounded-full border-2 border-dashed sm:size-28"
    >
      {state === "listening" && (
        <span
          aria-hidden="true"
          className="border-accent absolute inset-0 animate-ping rounded-full border-2 opacity-60"
        />
      )}

      <span className="text-foreground text-sm font-extrabold">Robin</span>

      <span aria-hidden="true" className="flex h-4 items-end gap-1">
        {state === "thinking" &&
          [0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="bg-muted size-1.5 animate-bounce rounded-full"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        {state === "speaking" &&
          [0, 120, 240, 360].map((delay) => (
            <span
              key={delay}
              className="bg-foreground h-3 w-1 animate-pulse rounded-full"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
      </span>

      <span className="text-faint font-mono text-[0.625rem] leading-tight">
        {LABELS[state]}
      </span>
      <span className="text-faint absolute -bottom-5 font-mono text-[0.5625rem] tracking-[0.12em] whitespace-nowrap uppercase">
        arte pendente
      </span>
    </div>
  );
}
