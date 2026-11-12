import { creditsText, type CreditSummary } from "@/lib/credits/summary";

import { formatDay } from "./format";

/**
 * Her credits (#273): the balance, how many end first and on which day, and
 * how many have no end while her subscription is alive. A month paid ahead
 * may show only after the daily routine, while a debit already counts it.
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
      {summary.lasting > 0 && (
        <p className="text-muted text-sm">
          Os créditos do plano não vencem enquanto a assinatura estiver ativa.
        </p>
      )}
    </section>
  );
}
