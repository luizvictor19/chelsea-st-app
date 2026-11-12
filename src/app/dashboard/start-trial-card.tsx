import Link from "next/link";

/**
 * Shown to a student of Chelsea St who never subscribed (#275): the way from
 * the signup to the trial. The plan screen does the rest (the plan, the CPF,
 * the trial, card or Pix). A card and not a redirect: the students who came
 * by invite and do not subscribe keep their screen.
 */
export function StartTrialCard() {
  return (
    <section
      aria-label="Teste grátis"
      className="border-accent bg-surface flex flex-col gap-3 rounded-sm border p-6"
    >
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        Teste grátis
      </p>
      <h2 className="text-xl font-bold tracking-tight">
        Comece o seu teste grátis
      </h2>
      <p className="text-muted">
        Escolha um plano e use de graça durante o período de teste. A primeira
        cobrança só vem depois dele.
      </p>
      <Link
        href="/dashboard/plano"
        className="bg-accent text-accent-foreground self-start rounded-sm px-5 py-3 font-semibold"
      >
        Escolher o plano
      </Link>
    </section>
  );
}
