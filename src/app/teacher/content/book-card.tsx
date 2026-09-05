import Link from "next/link";

import type { BookSummary } from "@/lib/content/queries";

/**
 * One book in the index.
 *
 * A book without a range is still a link: setting the range is exactly what the
 * teacher has to come here to do. Only the books that are neither configured
 * nor the next one in line are quietened, and even those keep full contrast on
 * their own text.
 */
export function BookCard({
  book,
  next = false,
}: {
  book: BookSummary;
  /** The first book still missing a range, which is the one to do now. */
  next?: boolean;
}) {
  const hasRange = book.firstPoint !== null && book.lastPoint !== null;
  const hasContent = book.progress.filled > 0;
  const quiet = !hasRange && !next;

  return (
    <Link
      href={`/teacher/content/${book.position}`}
      className={[
        "flex h-full w-full flex-col gap-3.5 rounded-sm border p-5 transition-colors",
        hasContent
          ? "border-accent bg-surface"
          : quiet
            ? "border-rule bg-background hover:border-accent hover:bg-surface"
            : "border-rule bg-surface hover:border-accent",
      ].join(" ")}
    >
      <div className="flex items-baseline gap-2.5">
        <span className="text-faint font-mono text-xs">
          {String(book.position).padStart(2, "0")}
        </span>
        <span
          className={`font-bold tracking-tight ${quiet ? "text-muted" : ""}`}
        >
          {book.title}
        </span>
        {hasRange ? (
          <span className="text-faint ml-auto font-mono text-xs">
            {book.firstPoint}–{book.lastPoint}
          </span>
        ) : null}
      </div>

      {hasRange ? (
        <BookProgress book={book} />
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-faint font-mono text-xs">
            sem faixa definida
          </span>
          <Bar percent={0} />
        </div>
      )}

      {hasRange ? (
        book.lastFilledPoint === null ? (
          <span className="text-faint text-xs">Nenhum ponto preenchido</span>
        ) : (
          <span className="text-muted text-xs">
            Parou no ponto{" "}
            <span className="text-foreground font-mono">
              {book.lastFilledPoint}
            </span>
          </span>
        )
      ) : (
        <span
          className={`text-xs font-semibold ${quiet ? "text-faint" : "text-accent"}`}
        >
          Definir faixa →
        </span>
      )}
    </Link>
  );
}

function BookProgress({ book }: { book: BookSummary }) {
  const percent = Math.round(book.progress.fraction * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted font-mono text-xs">
          {book.progress.filled} de {book.progress.total} · {percent}%
        </span>
        <span className="text-faint font-mono text-xs">
          faltam {book.progress.remaining}
        </span>
      </div>
      <Bar percent={percent} />
    </div>
  );
}

/** Decorative: every card spells the same numbers out in text above it. */
function Bar({ percent }: { percent: number }) {
  return (
    <div
      aria-hidden
      className="bg-rule h-1 w-full overflow-hidden rounded-full"
    >
      <div className="bg-accent h-full" style={{ width: `${percent}%` }} />
    </div>
  );
}
