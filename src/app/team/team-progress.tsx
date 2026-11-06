import {
  formatMinutes,
  summaryLine,
  teamSummary,
  type TeamRow,
} from "@/lib/team";
import { DAILY_PRACTICE_MINUTES } from "@/lib/tutor/daily-cap";

export type TeamSection = {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly rows: readonly TeamRow[];
};

/**
 * The team's practice, one section per organization (one in the normal case):
 * who joined, the days practised in each of the last weeks, the last day, and
 * the month's time against the time available. Who was invited and has not
 * joined yet stays in the invite list below. Presentation only: teamOf decides
 * what each row says.
 */
export function TeamProgress({
  sections,
  weeks,
}: {
  readonly sections: readonly TeamSection[];
  /** The Monday of each week shown, oldest first. */
  readonly weeks: readonly string[];
}) {
  return (
    <section aria-labelledby="team" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="team" className="text-xl font-bold tracking-tight">
          Equipe
        </h2>
        <p className="text-muted text-sm">
          Dias de prática por semana, de segunda a domingo, e o tempo praticado
          no mês contra o tempo disponível ({DAILY_PRACTICE_MINUTES} min por
          dia). O que cada pessoa disse fica só com ela.
        </p>
      </div>
      {sections.map((section) => (
        <TeamOf
          key={section.organizationId}
          section={section}
          weeks={weeks}
          named={sections.length > 1}
        />
      ))}
    </section>
  );
}

function TeamOf({
  section,
  weeks,
  named,
}: {
  readonly section: TeamSection;
  readonly weeks: readonly string[];
  readonly named: boolean;
}) {
  const summary = teamSummary(section.rows);

  return (
    <div className="flex flex-col gap-3">
      {named ? <h3 className="font-bold">{section.organizationName}</h3> : null}
      {section.rows.length === 0 ? (
        <p className="text-muted">
          Ninguém entrou ainda. Convide as pessoas da empresa abaixo.
        </p>
      ) : (
        <>
          <p>
            {summaryLine(summary)} No mês:{" "}
            {formatMinutes(summary.minutesThisMonth)} de{" "}
            {formatMinutes(summary.minutesAvailable)} disponíveis.
          </p>
          <ul className="border-rule divide-rule divide-y rounded-sm border">
            {section.rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-semibold">{row.name}</span>
                  <span className="text-muted text-sm">
                    Entrou em {row.joinedOn}
                  </span>
                </div>
                <p className="text-muted text-sm">
                  Última prática: {row.lastPractice} · Tempo no mês:{" "}
                  {formatMinutes(row.minutesThisMonth)} de{" "}
                  {formatMinutes(row.minutesAvailable)}
                </p>
                <dl
                  className="grid gap-2 text-center"
                  style={{
                    gridTemplateColumns: `repeat(${row.daysByWeek.length}, minmax(0, 1fr))`,
                  }}
                >
                  {row.daysByWeek.map((days, index) => (
                    <div
                      key={weeks[index] ?? index}
                      className="bg-surface rounded-sm px-1 py-2"
                    >
                      <dt className="text-faint font-mono text-xs">
                        {index === row.daysByWeek.length - 1
                          ? "esta semana"
                          : weeks[index]}
                      </dt>
                      <dd className="font-semibold">
                        {days === 1 ? "1 dia" : `${days} dias`}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
