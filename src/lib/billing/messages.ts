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
  billing_cycle_offered: "Este plano é só mensal. Escolha a cobrança mensal.",
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
