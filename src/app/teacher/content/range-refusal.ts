/**
 * The refusal of materialize_points (0039) when a narrower range would delete
 * points something still needs, in English as the database raises it. Read
 * here and asserted word for word by scripts/verify-rls.sql: a change to the
 * sentence is made in both places and in the migration.
 */
const REFUSAL =
  /^cannot narrow book [0-9a-f-]+ to (\d+)\.\.(\d+): (\d+) point\(s\) outside carry content, (\d+) lesson\(s\) reach outside, (\d+) point\(s\) outside are where a lesson stopped$/u;

function reasons(content: number, lessons: number, stopped: number): string[] {
  const found: string[] = [];
  if (content > 0) {
    found.push(
      content === 1
        ? "1 ponto fora desse intervalo tem conteúdo"
        : `${content} pontos fora desse intervalo têm conteúdo`,
    );
  }
  if (lessons > 0) {
    found.push(
      lessons === 1
        ? "1 lição vai além desse intervalo"
        : `${lessons} lições vão além desse intervalo`,
    );
  }
  if (stopped > 0) {
    found.push(
      stopped === 1
        ? "1 ponto fora desse intervalo é onde uma aula parou"
        : `${stopped} pontos fora desse intervalo são onde aulas pararam`,
    );
  }
  return found;
}

function joined(parts: readonly string[]): string {
  if (parts.length < 2) {
    return parts.join("");
  }
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/**
 * The teacher's sentence for that refusal, naming only the reasons that are
 * not zero; null for any other error, which the screen shows as it came. The
 * two-reason sentence of the function before 0039 is not recognised, so a
 * database without 0039 shows its own words instead of a half translation.
 */
export function rangeRefusal(error: {
  readonly code?: string | null;
  readonly message: string;
}): string | null {
  if (error.code !== "P0001") {
    return null;
  }
  const match = REFUSAL.exec(error.message);
  if (match === null) {
    return null;
  }
  const [, first, last, content, lessons, stopped] = match;
  const found = reasons(Number(content), Number(lessons), Number(stopped));
  if (found.length === 0) {
    return null;
  }
  return `Não dá para mudar o livro para os pontos ${first} a ${last}: ${joined(found)}.`;
}
