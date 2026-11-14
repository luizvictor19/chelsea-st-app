/**
 * What each kind of invite does, said on /teacher/invites (#366): a line and the
 * steps of "Como funciona", from the invite to where the person ends up,
 * shown where each invite lives. Plain text, a plain module.
 */

export type InviteKind = "organization" | "founder" | "personal";

export const INVITE_KINDS: Readonly<
  Record<
    InviteKind,
    {
      readonly line: string;
      readonly steps: readonly string[];
      readonly note?: string;
    }
  >
> = {
  organization: {
    line: "Põe alguém numa escola ou empresa com um papel. Não cobra nada pelo app.",
    steps: [
      "Você escolhe a organização, o papel e o e-mail.",
      "A pessoa recebe o e-mail e entra, ou cria a conta, com esse endereço.",
      "Ela passa a ver as telas do papel: professor e admin ensinam e cuidam da escola; funcionário pratica pela empresa, que paga pelo contrato, fora do app.",
    ],
  },
  founder: {
    line: "Dá o selo de fundador a um e-mail. Com ele, a pessoa assina o Plano Fundador.",
    steps: [
      "Você escreve o e-mail.",
      "A pessoa recebe o convite e cria a conta com esse e-mail (ou entra, se já tem).",
      "Ao confirmar o e-mail, ela ganha o selo e ocupa uma vaga.",
      "Em Plano e pagamento, ela assina o Plano Fundador, com cartão ou Pix.",
    ],
    note: "Para quem chega pela landing, use o cupom de Fundadores: o link do botão já leva o cupom.",
  },
  personal: {
    line: "Um Plano Fundador só para um e-mail, com o preço, os créditos e o custo da aula que você decide.",
    steps: [
      "Você escreve o e-mail e os números do plano.",
      "A pessoa recebe o convite e cria a conta com esse e-mail (ou entra, se já tem).",
      "O plano dela abre direto em Plano e pagamento, para assinar com cartão ou Pix.",
      "Os números se mudam depois em Planos, seção Personalizados.",
    ],
  },
};
