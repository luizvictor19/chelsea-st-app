/**
 * The e-mail of a founder invite (#296, 0059), from agenda@ like the
 * personal plan's, so both founder e-mails come from one address and the
 * replies reach Luiz. Two texts: the invite for an e-mail with no confirmed
 * account (the seal comes when she confirms it), and the seal already given
 * to an account confirmed with it (Q3 of 12/11). No number: the price and
 * the seats are read on the screens.
 *
 * The address rides in the fragment of the signup link
 * (/cadastro#fundador&email=...), which no browser sends to a server: it
 * enters no log. The link decides nothing; the seal is the database's, on
 * the confirmation of that e-mail.
 *
 * Pure: no clock, no network.
 */

import { CHELSEA } from "./brand.ts";
import type { Email } from "./mail/mailer.ts";
import { AGENDA_ADDRESS } from "./mail/senders.ts";

export const FOUNDER_INVITE_FROM = `${CHELSEA.name} <${AGENDA_ADDRESS}>`;

/** The signup, the address in the fragment and the founder's mark beside it. */
export function founderSignupLink(origin: string, email: string): string {
  return `${new URL("/cadastro", origin).toString()}#fundador&email=${encodeURIComponent(email)}`;
}

/** The link the invite carries: the signup, or the login once the seal is hers. */
export function founderInviteLink(
  origin: string,
  email: string,
  granted: boolean,
): string {
  return granted
    ? new URL("/login", origin).toString()
    : founderSignupLink(origin, email);
}

export function founderInviteEmail(input: {
  readonly to: string;
  readonly origin: string;
  /** The seal is already hers: an account was confirmed with this e-mail. */
  readonly granted: boolean;
}): Email {
  const link = founderInviteLink(input.origin, input.to, input.granted);
  if (input.granted) {
    return {
      to: input.to,
      subject: "Você ganhou o selo de fundadora",
      replyTo: AGENDA_ADDRESS,
      text: [
        "Olá,",
        "",
        `Você ganhou o selo de fundadora do ${CHELSEA.name}. Ele é seu para sempre: com ele você assina o Plano Fundador, pelo preço de fundadora.`,
        `Entre com este e-mail, ${input.to}, e veja o Plano Fundador em Plano e pagamento: ${link}`,
        "",
        "Dúvidas? É só responder este e-mail.",
        "",
        `Equipe ${CHELSEA.name}`,
      ].join("\n"),
    };
  }
  return {
    to: input.to,
    subject: "Você foi convidada como fundadora",
    replyTo: AGENDA_ADDRESS,
    text: [
      "Olá,",
      "",
      `Você foi convidada para ser fundadora do ${CHELSEA.name}. Fundadora tem o selo para sempre e assina o Plano Fundador, pelo preço de fundadora.`,
      `Crie a sua conta com este mesmo e-mail, ${input.to}: o selo entra quando você confirmar o e-mail.`,
      "",
      `Criar a conta: ${link}`,
      "",
      "As vagas de fundador são poucas, e o convite não guarda vaga: quem confirma primeiro fica com ela.",
      "",
      "Dúvidas? É só responder este e-mail.",
      "",
      `Equipe ${CHELSEA.name}`,
    ].join("\n"),
  };
}

/**
 * What /cadastro reads in its fragment: the address of an invite (a founder
 * invite or a personal plan, #292) and whether it is a founder invite.
 */
export function readSignupFragment(hash: string): {
  readonly email: string | null;
  readonly founder: boolean;
} {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const email = params.get("email")?.trim() ?? "";
  return {
    email: email === "" ? null : email,
    founder: params.has("fundador"),
  };
}
