import { groupByLesson, type LessonRange } from "@/lib/content/lesson-range";
import type { Gap } from "@/lib/content/progress";
import type { BookPoint } from "@/lib/content/queries";

/**
 * Every point of the book at once, cut into the lessons they belong to, so the
 * shape of what is done and what is missing can be read in a glance. The holes
 * are called out inside this card rather than in a banner of their own: a gap
 * is a fact about the sequence, and the sequence is right here.
 *
 * The squares are laid on a fixed-width grid rather than a wrapping row, so the
 * columns line up down the card and point 9 is exactly as wide as point 128.
 * That uniformity is what carries the meaning: a solid square against an
 * outlined one needs no legend.
 *
 * A lesson gets a row of its own rather than a mark inside a continuous run.
 * The ruler wraps, so a group that began in the middle of a line would put its
 * label where nobody could tell which squares it named.
 */
export function PointGrid({
  points,
  lessons,
  gaps,
  complete,
  lastFilledPoint,
  lastFilledLesson,
}: {
  points: readonly BookPoint[];
  lessons: readonly LessonRange[];
  gaps: readonly Gap[];
  /** Every point is filled, which silences the two lines under the grid. */
  complete: boolean;
  lastFilledPoint: number | null;
  lastFilledLesson: number | null;
}) {
  const inGap = new Set<number>();
  for (const gap of gaps) {
    for (let number = gap.from; number <= gap.to; number += 1) {
      inGap.add(number);
    }
  }

  const groups = groupByLesson(points, lessons);
  // Written, and belonging to no lesson: invisible until now, and the reason
  // this card names the lessons at all.
  const orphans = points.filter(
    (point) => point.filled && point.lesson === null,
  );

  return (
    <section
      aria-label="Pontos"
      className="border-rule bg-surface flex flex-col gap-3.5 rounded-sm border p-5"
    >
      <h2 className="font-bold tracking-tight">Pontos</h2>

      <div className="flex flex-col">
        {groups.map((group, index) => (
          <div
            // The first point of the group: a lesson can label two groups when
            // its recorded range overlaps the next one's, and its number would
            // then be the same key twice.
            key={group.points[0]?.number ?? index}
            className={`flex items-start gap-3 py-2 ${
              index === 0 ? "" : "border-rule border-t"
            }`}
          >
            <span
              className={`w-[4.5rem] flex-shrink-0 pt-2 font-mono text-[0.625rem] tracking-[0.14em] uppercase ${
                group.lesson === null ? "text-accent" : "text-faint"
              }`}
            >
              {group.lesson === null ? "sem lição" : `Lição ${group.lesson}`}
            </span>
            <ol className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,2rem)] gap-1">
              {group.points.map((point) => {
                const orphan = point.filled && point.lesson === null;
                const gapped = inGap.has(point.number);
                const state = orphan
                  ? "bg-accent text-accent-foreground border-accent"
                  : point.filled
                    ? "bg-foreground text-background border-foreground"
                    : gapped
                      ? "border-accent text-accent"
                      : "border-rule text-faint";
                return (
                  <li
                    key={point.number}
                    title={
                      orphan
                        ? "preenchido, sem lição"
                        : point.filled
                          ? `cheio, lição ${String(point.lesson)}`
                          : gapped
                            ? "buraco"
                            : "vazio"
                    }
                    className={`flex h-8 items-center justify-center rounded-[0.1875rem] border font-mono text-[0.6875rem] tabular-nums ${state}`}
                  >
                    {point.number}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>

      <div className="border-rule flex flex-col gap-1 border-t pt-3">
        {/*
          Where the teacher stopped is a question about work still to come. A
          finished book raises it no longer, and says it is done in its place.
          The accent separates that line from the grey the other status lines
          use, and the tick carries the meaning with the word, so it does not
          rest on noticing the colour.
        */}
        {complete ? (
          <p className="text-accent text-sm font-semibold">✓ completo</p>
        ) : lastFilledPoint === null ? (
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

        {orphans.length > 0 && (
          <div className="text-accent flex flex-col gap-1 text-xs leading-relaxed">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="bg-accent border-accent h-2.5 w-2.5 rounded-[0.125rem] border"
              />
              <span className="font-mono text-[0.625rem]">sem lição</span>
            </span>
            <p>
              Gravado sem lição:{" "}
              <span className="font-mono">
                {orphans.map((point) => point.number).join(", ")}
              </span>
              . A lição nasce quando uma página dela é confirmada, e estes
              pontos entram nela sozinhos assim que isso acontecer.
            </p>
          </div>
        )}

        {/*
            "até aqui" is the whole of this line: it reports on the stretch
            already covered, and a finished book has no stretch left for a hole
            to appear in. A hole that does exist is still named below.
          */}
        {complete ? null : gaps.length === 0 ? (
          <p className="text-faint text-xs leading-relaxed">
            Sem buraco na sequência até aqui.
          </p>
        ) : (
          <div className="text-accent flex flex-col gap-1 text-xs leading-relaxed">
            {/*
             * A square that is empty yet already surrounded does not explain
             * itself; filled against empty does.
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
