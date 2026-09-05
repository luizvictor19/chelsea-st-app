import type { Gap } from "@/lib/content/progress";

/**
 * Every point of the book at once, so the shape of what is done and what is
 * missing can be read in a glance. The holes are called out inside this card
 * rather than in a banner of their own: a gap is a fact about the sequence, and
 * the sequence is right here.
 *
 * The squares are laid on a fixed-width grid rather than a wrapping row, so the
 * columns line up down the card and point 9 is exactly as wide as point 128.
 * That uniformity is what carries the meaning: a solid square against an
 * outlined one needs no legend. Only the gap marker gets one, and only when the
 * book actually has a gap.
 */
export function PointGrid({
  points,
  gaps,
  lastFilledPoint,
  lastFilledLesson,
}: {
  points: readonly { number: number; filled: boolean }[];
  gaps: readonly Gap[];
  lastFilledPoint: number | null;
  lastFilledLesson: number | null;
}) {
  const inGap = new Set<number>();
  for (const gap of gaps) {
    for (let number = gap.from; number <= gap.to; number += 1) {
      inGap.add(number);
    }
  }

  return (
    <section
      aria-label="Pontos"
      className="border-rule bg-surface flex flex-col gap-3.5 rounded-sm border p-5"
    >
      <h2 className="font-bold tracking-tight">Pontos</h2>

      <ol className="grid grid-cols-[repeat(auto-fill,2rem)] gap-1">
        {points.map((point) => {
          const gapped = inGap.has(point.number);
          const state = point.filled
            ? "bg-foreground text-background border-foreground"
            : gapped
              ? "border-accent text-accent"
              : "border-rule text-faint";
          return (
            <li
              key={point.number}
              title={point.filled ? "cheio" : gapped ? "buraco" : "vazio"}
              className={`flex h-8 items-center justify-center rounded-[0.1875rem] border font-mono text-[0.6875rem] tabular-nums ${state}`}
            >
              {point.number}
            </li>
          );
        })}
      </ol>

      <div className="border-rule flex flex-col gap-1 border-t pt-3">
        {lastFilledPoint === null ? (
          <p className="text-muted text-sm">Nenhum ponto preenchido ainda.</p>
        ) : (
          <p className="text-muted text-sm">
            Parou no ponto{" "}
            <span className="text-foreground font-mono">{lastFilledPoint}</span>
            {lastFilledLesson === null
              ? "."
              : `, lição ${String(lastFilledLesson)}.`}
          </p>
        )}
        {gaps.length === 0 ? (
          <p className="text-faint text-xs leading-relaxed">
            Sem buraco na sequência até aqui.
          </p>
        ) : (
          <div className="text-accent flex flex-col gap-1 text-xs leading-relaxed">
            {/*
             * The only legend the card keeps. Filled against empty explains
             * itself; a square that is empty yet already surrounded does not.
             */}
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="border-accent h-2.5 w-2.5 rounded-[0.125rem] border"
              />
              <span className="font-mono text-[0.625rem]">buraco</span>
            </span>
            <p>
              Buraco na sequência. Ficaram vazios entre pontos já preenchidos:{" "}
              <span className="font-mono">
                {gaps
                  .map((gap) =>
                    gap.from === gap.to
                      ? String(gap.from)
                      : `${gap.from} a ${gap.to}`,
                  )
                  .join(", ")}
              </span>
              .
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
