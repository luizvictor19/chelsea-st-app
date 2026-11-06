/**
 * The practice with Robin, for someone who only practises: an employee of a
 * company without a teacher (0042). Until Robin v1 (#71) it holds the place,
 * in the mould of the daily challenge: the screen is never blank, and the
 * promise names no lesson she does not have. Robin v1 replaces this component.
 */
export function RobinPractice() {
  return (
    <section
      aria-label="Prática com o Robin"
      className="border-rule flex flex-col gap-2 rounded-sm border border-dashed p-6"
    >
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        Prática com o Robin
      </p>
      <p className="text-muted">
        Em breve você pratica inglês aqui com o Robin, alguns minutos por dia,
        na hora que quiser.
      </p>
      {/* What team_practice (0044) lets the company's admin see, and no more. */}
      <p className="text-faint text-sm">
        A empresa vê em que dias e por quanto tempo você praticou, nunca o que
        você disse.
      </p>
    </section>
  );
}
