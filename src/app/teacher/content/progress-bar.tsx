import type { Progress } from "@/lib/content/progress";

/** A filled-against-total bar, with the count spelled out beside it. */
export function ProgressBar({
  progress,
  label,
  emphasis = false,
}: {
  progress: Progress;
  label: string;
  emphasis?: boolean;
}) {
  const percent = Math.round(progress.fraction * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={emphasis ? "text-sm font-semibold" : "text-muted text-sm"}
        >
          {label}
        </span>
        <span className="text-faint font-mono text-xs">
          {progress.total === 0
            ? "não configurado"
            : `${progress.filled} de ${progress.total} · ${percent}% · faltam ${progress.remaining}`}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={progress.filled}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-label={label}
        className="bg-rule h-1 w-full overflow-hidden rounded-full"
      >
        <div
          className={emphasis ? "bg-accent h-full" : "bg-foreground h-full"}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
