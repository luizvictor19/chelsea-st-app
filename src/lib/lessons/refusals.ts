/**
 * What the screen says when the database refuses a booking, a cancel or a
 * teacher's hours (0052, and the ledger's credits_not_negative and
 * credit_cost_known of 0050). Every refusal there names its rule at the start
 * of its message, because the API passes the message on and not the
 * constraint; a refusal Postgres raises itself (an exclusion, a check) names
 * it inside the message. refusals.test.ts holds every name 0052 raises to a
 * sentence here.
 */

const SENTENCES: Readonly<Record<string, string>> = {
  lesson_slot_bookable: "Esse horário não está mais livre. Escolha outro.",
  lessons_teacher_no_overlap:
    "Esse horário acabou de ser reservado. Escolha outro.",
  lessons_student_no_overlap: "Você já tem aula nesse horário.",
  credits_not_negative: "Seu saldo não cobre esta aula.",
  credit_cost_known: "As aulas ainda não estão à venda.",
  credit_debit_reference_used: "Essa aula já foi paga.",
  lesson_booking_student: "Só quem é aluno ativo reserva aula.",
  lesson_booking_needs_teacher: "Sua organização não tem aula com professor.",
  lesson_booking_same_organization: "Esse professor não é da sua organização.",
  lesson_teacher_active: "Esse professor não está aceitando reservas agora.",
  lesson_cancel_allowed: "Essa aula não está entre as que você cancela.",
  lesson_cancel_before_start:
    "A aula já começou e não pode mais ser cancelada.",
  lesson_cancel_before_end: "A aula já terminou e não pode mais ser cancelada.",
  lesson_cancel_scheduled: "Essa aula já não está agendada.",
  lessons_booked_through_functions:
    "Uma aula reservada só muda pela reserva ou pelo cancelamento.",
  teachers_active_needs_contact:
    "Para aceitar reservas, preencha o link do Meet e o e-mail da agenda.",
  teachers_meet_url_https: "O link do Meet precisa começar com https://.",
  teachers_calendar_email_shape: "Confira o e-mail da agenda.",
  teachers_one_per_organization: "Seu perfil de professor já existe.",
  teachers_membership_fkey: "Você não ensina nessa organização.",
  teacher_availability_timezone_known:
    "O fuso horário do seu perfil não é reconhecido. Nada foi salvo.",
  teacher_availability_ends_after_start:
    "O fim da janela precisa vir depois do início.",
  teacher_time_off_ends_after_start:
    "O fim da folga precisa vir depois do início.",
};

/** Said when the refusal names no rule this screen knows. */
export const UNKNOWN_REFUSAL =
  "Não foi possível concluir agora. Recarregue a página e tente de novo.";

/** The names this module has a sentence for. */
export const KNOWN_REFUSALS: readonly string[] = Object.keys(SENTENCES);

/**
 * The sentence for a refusal, by the first rule its message names. The
 * longest name is tried first, so a name that holds another is never read
 * as the shorter one. A message naming none gets UNKNOWN_REFUSAL, never a
 * blank screen and never the database's English.
 */
export function refusalSentence(message: string | null | undefined): string {
  const text = message ?? "";
  const name = [...KNOWN_REFUSALS]
    .sort((a, b) => b.length - a.length)
    .find((candidate) => text.includes(candidate));
  return name === undefined ? UNKNOWN_REFUSAL : SENTENCES[name];
}
