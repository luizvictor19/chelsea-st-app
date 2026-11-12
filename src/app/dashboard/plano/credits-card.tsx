import { creditsText, type CreditSummary } from "@/lib/credits/summary";

import { formatDay } from "./format";

/**
 * Her credits (#273): the balance and how many end first. The balance is the
 * sum of her live lots; between midnight and the daily routine a carryover
 * may not show yet, while a debit already counts it.
 */
export function CreditsCard({ summary }: { readonly summary: CreditSummary }) {
  return (
    <section
      aria-label="Seus créditos"
      className="border-rule bg-surface flex flex-col gap-2 rounded-sm border p-6"
    >
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        Seus créditos
      </p>
      <p className="text-xl font-extrabold">{creditsText(summary.balance)}</p>
      {summary.next !== null && (
        <p className="text-muted text-sm">
          {creditsText(summary.next.credits)}{" "}
          {summary.next.credits === 1 ? "vale" : "valem"} até{" "}
          {formatDay(summary.next.lastDay)}.
        </p>
      )}
    </section>
  );
}
