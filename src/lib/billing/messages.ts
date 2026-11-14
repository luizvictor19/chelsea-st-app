/**
 * What the person reads about her payment: the e-mails of the overdue
 * routine and the sentences of the plan screen. Portuguese, for the person
 * (AGENTS.md). The brand's name comes from brand.ts, the one place it is
 * written.
 */

import { CHELSEA } from "../brand.ts";

const BRAND = CHELSEA.name;

/** Why a subscription could not start, by the refusal's name. */
export const SUBSCRIBE_REFUSALS: Readonly<Record<string, string>> = {
  invalid_cpf: "Confira o CPF: ele não é válido.",
  invalid_name: "Digite o seu nome completo.",
  billing_customers_one_person_per_cpf:
    "Este CPF já está em outra conta. Entre com ela, ou fale com a gente.",
  billing_customers_one_cpf_per_person:
    "A sua conta já assina com outro CPF. Use o mesmo CPF de antes.",
  billing_one_trial_per_person:
    "O seu teste grátis já foi usado. Assine sem o teste.",
  billing_plan_active: "Este plano não está mais à venda. Escolha outro.",
  billing_plan_audience:
    "Este plano não está disponível para você. Escolha outro.",
  billing_value_matches:
    "O valor deste plano mudou. Recarregue a página e assine de novo.",
  subscriptions_one_alive_per_person:
    "Você já tem uma assinatura ativa. Cancele a atual antes de assinar outra.",
};

export function overdueEmail(input: {
  day: number;
  lastDay: number;
  billingType: "card" | "pix";
  canceled: boolean;
  invoiceUrl: string | null;
  planUrl: string;
}): { subject: string; text: string } {
  const pay = input.invoiceUrl ?? input.planUrl;
  if (input.canceled) {
    return {
      subject: `${BRAND}: sua assinatura foi cancelada`,
      text: [
        "Olá,",
        "",
        `O pagamento da sua assinatura ${BRAND} não foi confirmado em ${input.lastDay} dias, e a assinatura foi cancelada.`,
        "",
        `Para voltar a praticar, assine de novo em ${input.planUrl}`,
        "",
        `Equipe ${BRAND}`,
      ].join("\n"),
    };
  }
  const left = input.lastDay - input.day;
  const first =
    input.billingType === "card"
      ? "Tentamos cobrar a sua assinatura no cartão, e o pagamento não passou."
      : "O Pix da sua assinatura venceu e ainda não foi pago.";
  return {
    subject: `${BRAND}: o pagamento da sua assinatura não passou`,
    text: [
      "Olá,",
      "",
      first,
      `Faltam ${left} ${left === 1 ? "dia" : "dias"} para a assinatura ser cancelada.`,
      "",
      `Para pagar, ou pagar com outro cartão: ${pay}`,
      "",
      `Equipe ${BRAND}`,
    ].join("\n"),
  };
}

/**
 * Why a withdrawal (#297, 0060) could not be asked for, by the refusal's
 * name; and what the screen says while it is on its way.
 */
export const REFUND_REFUSALS: Readonly<Record<string, string>> = {
  refund_requests_one_open: "O seu pedido de reembolso já está em andamento.",
  refund_requests_once_per_payment: "O reembolso desta cobrança já foi pedido.",
  billing_refund_window: "O prazo de 7 dias para desistir já passou.",
  billing_refund_lessons_ahead:
    "Cancele antes as aulas marcadas. Depois, peça o reembolso.",
  billing_refund_nothing: "Não há valor a devolver nesta cobrança.",
  provider_refused:
    "Não conseguimos pedir o reembolso agora. Nada foi cancelado. Tente de novo em alguns instantes.",
};

/**
 * When the provider takes the refund only later (REFUND_LATER in
 * withdraw.ts): on a card, a partial refund goes from the day after the
 * charge on (measured in the sandbox on 14/11/2026).
 */
export const REFUND_LATER_SENTENCE =
  "Pedido guardado. No cartão, o reembolso só sai a partir do dia seguinte ao pagamento: ele vai sozinho, e a assinatura é cancelada quando ele sair.";

/** The text the refund goes with at the provider. */
export const REFUND_DESCRIPTION = `Desistência da assinatura ${BRAND} (CDC art. 49)`;

/**
 * The notice to the brand's contact while the refund waits for the critical
 * event's authorization in the provider's panel (Q3 A of #297). The charge's
 * id at the provider and nothing of the person: no name, no e-mail.
 */
export function refundNoticeEmail(paymentId: string): {
  subject: string;
  text: string;
} {
  return {
    subject: `${BRAND}: reembolso pedido, autorize no painel da Asaas`,
    text: [
      "Uma pessoa desistiu da assinatura no prazo de 7 dias e pediu o reembolso proporcional (CDC art. 49).",
      "",
      `Cobrança na Asaas: ${paymentId}`,
      "",
      "O estorno espera a sua autorização no painel da Asaas (evento crítico). O app só o conta como feito quando a Asaas disser DONE.",
    ].join("\n"),
  };
}
