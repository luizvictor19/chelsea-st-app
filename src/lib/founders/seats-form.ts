/**
 * The total of founder seats, as /teacher/founders reads it before the
 * database does (founder_program, 0058: founder_program_seats_not_negative).
 * The number lives only in the database, never in the repository (ADR 0006).
 */

export type SeatsRead =
  | { readonly ok: true; readonly seats: number }
  | { readonly ok: false; readonly message: string };

/** Above this, a typo and not a plan: Postgres integer stops far beyond. */
const MOST = 100_000;

export function readSeatsForm(form: FormData): SeatsRead {
  const text = String(form.get("seats_total") ?? "").trim();
  if (!/^\d+$/.test(text) || Number(text) > MOST) {
    return {
      ok: false,
      message: "O total de vagas é um número inteiro, zero ou mais.",
    };
  }
  return { ok: true, seats: Number(text) };
}

/** What the screen says when badge_grant or grant_badge refuses (0058). */
export function sealRefusal(error: {
  readonly code?: string;
  readonly message?: string;
}): string {
  const message = error.message ?? "";
  if (message.includes("founder_seats_available")) {
    return "Não há vaga de fundador. Aumente o total em Vagas.";
  }
  if (error.code === "42501") {
    return "Só o admin da plataforma dá ou tira o selo.";
  }
  return "Não foi possível gravar agora. Tente de novo em alguns instantes.";
}
