/**
 * The seals a person holds and who reads each plan (#292, 0058). Two lists
 * the database also holds, in its checks person_badges_badge_known and
 * plans_audience_known: badge-keys.test.ts keeps them equal, so a seal or an
 * audience is a migration and a code change together.
 *
 * Pure: no database, no clock.
 */

export const BADGE_KEYS = ["founder"] as const;
export type BadgeKey = (typeof BADGE_KEYS)[number];

/** How a seal came: by the platform admin (a repair), a coupon or an invite (#296). */
export const BADGE_SOURCES = ["admin", "coupon", "invite"] as const;
export type BadgeSource = (typeof BADGE_SOURCES)[number];

export const PLAN_AUDIENCES = ["public", "founder", "person"] as const;
export type PlanAudience = (typeof PLAN_AUDIENCES)[number];

/** The audiences the plan screen of the platform admin chooses from. */
export const CATALOG_AUDIENCES = [
  "public",
  "founder",
] as const satisfies readonly PlanAudience[];

export const BADGE_LABEL: Readonly<Record<BadgeKey, string>> = {
  founder: "Fundador",
};

export const BADGE_SOURCE_LABEL: Readonly<Record<BadgeSource, string>> = {
  admin: "dado à mão",
  coupon: "cupom",
  invite: "convite",
};

export const AUDIENCE_LABEL: Readonly<Record<PlanAudience, string>> = {
  public: "Todos",
  founder: "Só fundadores",
  person: "Uma pessoa (personalizado)",
};

export function isPlanAudience(value: unknown): value is PlanAudience {
  return (PLAN_AUDIENCES as readonly unknown[]).includes(value);
}

export function isBadgeSource(value: unknown): value is BadgeSource {
  return (BADGE_SOURCES as readonly unknown[]).includes(value);
}

const DAY = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

/** A moment as its day in São Paulo, "dd/mm/aaaa". */
export function daySaoPaulo(at: string): string {
  return DAY.format(new Date(at));
}

/** "Selo de fundador · desde dd/mm/aaaa", the day in São Paulo. */
export function founderSince(grantedAt: string): string {
  return `Selo de fundador · desde ${daySaoPaulo(grantedAt)}`;
}

/** The line above the plans for whoever holds the seal. */
export function founderLine(grantedAt: string): string {
  return `${founderSince(grantedAt)}. Você pode ficar no Plano Fundador, ou voltar a ele, pelo preço de fundador.`;
}
