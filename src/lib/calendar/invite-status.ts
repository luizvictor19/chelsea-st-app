/**
 * What the teacher's agenda says about the invites of a lesson still
 * scheduled (#294): a request abandoned, or one still waiting after a
 * failure. Read from calendar_invites (0056), which she reads under its
 * policy; the rows hold no address.
 */

export type InviteRow = {
  readonly method: string;
  readonly recipient: string;
  readonly status: string;
  readonly last_error: string | null;
};

const WHO: Readonly<Record<string, string>> = {
  student: "ao aluno",
  teacher: "ao seu e-mail da agenda",
};

function whom(rows: readonly InviteRow[]): string {
  return rows
    .map((row) => WHO[row.recipient] ?? "a alguém")
    .sort()
    .join(" nem ");
}

/** The lines to show on a lesson, none when every invite went or waits its turn. */
export function inviteWarnings(rows: readonly InviteRow[]): string[] {
  const requests = rows.filter((row) => row.method === "request");
  const abandoned = requests.filter((row) => row.status === "abandoned");
  const failing = requests.filter(
    (row) => row.status === "pending" && row.last_error !== null,
  );
  const lines: string[] = [];
  if (abandoned.length > 0) {
    lines.push(`Convite de agenda não enviado ${whom(abandoned)}.`);
  }
  if (failing.length > 0) {
    lines.push(
      `Convite de agenda ainda não enviado ${whom(failing)}: o sistema tenta de novo.`,
    );
  }
  return lines;
}
