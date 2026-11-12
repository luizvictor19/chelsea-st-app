/** Money and days as the person reads them, in Brazil. */

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCents(cents: number): string {
  return BRL.format(cents / 100);
}

/** "2026-11-26" as "26/11/2026". */
export function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: "Aguardando o pagamento no cartão",
  trialing: "Em teste grátis",
  active: "Ativa",
  past_due: "Pagamento em atraso",
  canceled: "Cancelada",
};
