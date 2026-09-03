/**
 * The daily challenge belongs to the next phase. Until it exists, this holds its
 * place: the screen is never allowed to be blank, and a promise is more honest
 * than an empty panel.
 */
export function DailyChallenge() {
  return (
    <section
      aria-label="Desafio do dia"
      className="border-rule flex flex-col gap-2 rounded-sm border border-dashed p-6"
    >
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        Desafio do dia
      </p>
      <p className="text-muted">
        O treino diário chega em breve. Por enquanto, o que vale é aparecer na
        aula.
      </p>
    </section>
  );
}
