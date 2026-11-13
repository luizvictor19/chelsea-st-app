/**
 * The e-mail of a Plano Fundador Personalizado (#292): the plan is ready for
 * one e-mail, and the person enters or creates her account to subscribe. It
 * names the plan and no number: the price and the credits are read on the
 * plan screen, once she is in. Portuguese, as every string a person reads.
 *
 * Two links and no "next": the confirmation e-mail of the signup carries only
 * the origin (auth-links.ts), so the way to the checkout is the front door's
 * (resolveDestination), after the login and after the signup alike. The
 * address goes in the fragment of the signup link, which never reaches a
 * server or its logs.
 *
 * Pure: no clock, no network.
 */

import { CHELSEA } from "./brand.ts";
import type { Email } from "./mail/mailer.ts";
import { AGENDA_ADDRESS } from "./mail/senders.ts";

/** From agenda@, the address whose replies reach Luiz. */
export const PERSONAL_PLAN_FROM = `${CHELSEA.name} <${AGENDA_ADDRESS}>`;

export function personalPlanEmail(input: {
  readonly to: string;
  readonly planName: string;
  readonly origin: string;
}): Email {
  const login = new URL("/login", input.origin).toString();
  const signup = `${new URL("/cadastro", input.origin).toString()}#email=${encodeURIComponent(input.to)}`;
  return {
    to: input.to,
    subject: "Seu plano personalizado está pronto",
    replyTo: AGENDA_ADDRESS,
    text: [
      "Olá,",
      "",
      `O seu plano personalizado, ${input.planName}, está pronto no ${CHELSEA.name}.`,
      `Entre com este mesmo e-mail, ${input.to}, e você vai direto para a assinatura. O plano é de quem usar este endereço.`,
      "",
      `Já tem conta? Entre: ${login}`,
      `Ainda não tem? Crie a sua conta: ${signup}`,
      "",
      "Dúvidas? É só responder este e-mail.",
      "",
      `Equipe ${CHELSEA.name}`,
    ].join("\n"),
  };
}
