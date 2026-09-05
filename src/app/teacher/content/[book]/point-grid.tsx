import type { Gap } from "@/lib/content/progress";

function LegendKey({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className={`h-2.5 w-2.5 rounded-[0.125rem] ${className}`}
      />
      <span className="text-faint font-mono text-[0.625rem]">{label}</span>
    </span>
  );
}

/**
 * Every point of the book at once, so the shape of what is done and what is
 * missing can be read in a glance. The holes are called out inside this card
 * rather than in a banner of their own: a gap is a fact about the sequence, and
 * the sequence is right here.
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
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-bold tracking-tight">Pontos</h2>
        <div className="flex items-center gap-3">
          <LegendKey className="bg-foreground" label="cheio" />
          <LegendKey className="border-rule border" label="vazio" />
          <LegendKey className="border-accent border" label="buraco" />
        </div>
      </div>

      <ol className="flex flex-wrap gap-1">
        {points.map((point) => {
          const state = point.filled
            ? "bg-foreground text-background border-foreground"
            : inGap.has(point.number)
              ? "border-accent text-accent"
              : "border-rule text-faint";
          return (
            <li
              key={point.number}
              title={
                point.filled
                  ? "cheio"
                  : inGap.has(point.number)
                    ? "buraco"
                    : "vazio"
              }
              className={`rounded-[0.1875rem] border px-1.5 py-1 font-mono text-[0.6875rem] ${state}`}
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
          <p className="text-accent text-xs leading-relaxed">
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
        )}
      </div>
    </section>
  );
}
