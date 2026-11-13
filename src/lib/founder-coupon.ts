/**
 * The founder coupon (#296, 0059), as the screens read it before the
 * database does. The database decides whether a code is good
 * (redeem_my_founder_coupon) and keeps only its sha256; here are the code a
 * personal coupon gets, the form of the platform admin, and the sentence of
 * each refusal.
 *
 * Pure: the random numbers come in, so the personal code is tested with a
 * fake.
 */

/**
 * Crockford's base 32: no I, L, O or U, so no letter is read as another or
 * as a digit. 12 characters of 32 are 60 bits.
 */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PERSONAL_CODE_LENGTH = 12;

/** The shortest and longest code the database takes once made normal (founder_coupons_code_length). */
export const CODE_MIN = 6;
export const CODE_MAX = 64;

/** A personal code: `randomInt(n)` returns an integer in [0, n), as node:crypto's. */
export function personalCode(randomInt: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < PERSONAL_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** A code made normal as founder_coupon_hash does: capitals, no spaces, no hyphens. */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
}

/** "XXXX-XXXX-XXXX": the same code, easier to read and to dictate. */
export function groupCode(code: string): string {
  return (normalizeCode(code).match(/.{1,4}/g) ?? []).join("-");
}

/**
 * The code as it rides from the signup to the metadata of the account (Q2
 * of 12/11): trimmed, cut at a length no code reaches, empty when absent.
 * Made normal later, by the database, as any typed code.
 */
export function signupCoupon(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .slice(0, CODE_MAX * 2);
}

/** The rules redeem_my_founder_coupon raises, each with what the person reads. */
export const COUPON_REFUSALS = {
  founder_coupon_exists:
    "Esse cupom não existe. Confira o código, letra por letra.",
  founder_coupon_expired: "Esse cupom venceu.",
  founder_coupon_exhausted: "Esse cupom já foi usado todas as vezes que podia.",
  founder_coupon_once_per_person: "Você já usou esse cupom.",
  founder_coupon_brand: "Esse cupom não vale para a sua conta.",
  founder_coupon_seats: "As vagas de fundador acabaram.",
} as const;

export type CouponRefusal = keyof typeof COUPON_REFUSALS;

const TRY_AGAIN =
  "Não foi possível usar o cupom agora. Tente de novo em alguns instantes.";

/**
 * The sentence for a refusal of redeem_my_founder_coupon. The API passes the
 * message on and not the constraint, so the name is read at the start of
 * the message, where 0059 puts it.
 */
export function couponRefusal(error: { readonly message?: string }): string {
  const name = (error.message ?? "").split(":")[0]?.trim();
  return name !== undefined && Object.hasOwn(COUPON_REFUSALS, name)
    ? COUPON_REFUSALS[name as CouponRefusal]
    : TRY_AGAIN;
}

/** What redeem_my_founder_coupon returned, as the screen says it. */
export function couponGranted(result: unknown): string {
  return result === "already_founder"
    ? "Você já tem o selo de fundador."
    : "Pronto: você ganhou o selo de fundador. O Plano Fundador está na lista de planos.";
}

export type CouponKind = "general" | "personal";

export type CouponValues = {
  readonly kind: CouponKind;
  /** The code typed by the admin; null for a personal coupon, drawn by the app. */
  readonly code: string | null;
  readonly label: string;
  readonly maxUses: number;
  readonly days: number;
};

export type CouponRead =
  | { readonly ok: true; readonly values: CouponValues }
  | { readonly ok: false; readonly message: string };

/** Beyond these, a typo and not a coupon. */
const MOST_USES = 100_000;
const MOST_DAYS = 365;

function wholeIn(text: string, low: number, high: number): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= low && value <= high ? value : null;
}

/**
 * The form of a new coupon on /teacher/founders. A general coupon has the
 * code, the uses and the days the admin types; a personal one, one use, a
 * code the app draws, and the days.
 */
export function readCouponForm(form: FormData): CouponRead {
  const kind: CouponKind =
    form.get("kind") === "personal" ? "personal" : "general";
  const label = String(form.get("label") ?? "").trim();
  if (label === "" || label.length > 120) {
    return {
      ok: false,
      message: "Dê um nome ao cupom, de até 120 letras (ele aparece na lista).",
    };
  }
  const days = wholeIn(String(form.get("days") ?? "").trim(), 1, MOST_DAYS);
  if (days === null) {
    return {
      ok: false,
      message: `A validade é um número de dias, de 1 a ${MOST_DAYS}.`,
    };
  }
  if (kind === "personal") {
    return { ok: true, values: { kind, code: null, label, maxUses: 1, days } };
  }

  const code = normalizeCode(form.get("code"));
  if (code.length < CODE_MIN || code.length > CODE_MAX) {
    return {
      ok: false,
      message: `O código tem de ${CODE_MIN} a ${CODE_MAX} letras ou números (espaços e hífens não contam).`,
    };
  }
  const maxUses = wholeIn(
    String(form.get("max_uses") ?? "").trim(),
    1,
    MOST_USES,
  );
  if (maxUses === null) {
    return {
      ok: false,
      message: "O número de usos é um número inteiro, 1 ou mais.",
    };
  }
  return { ok: true, values: { kind, code, label, maxUses, days } };
}

/** What the screen says when create_founder_coupon refuses (0059). */
export function couponCreateRefusal(error: {
  readonly code?: string;
  readonly message?: string;
}): string {
  if (error.code === "23505") {
    return "Já existe um cupom com esse código. Escolha outro.";
  }
  if ((error.message ?? "").startsWith("founder_coupons_code_length")) {
    return `O código tem de ${CODE_MIN} a ${CODE_MAX} letras ou números.`;
  }
  if (error.code === "42501") {
    return "Só o admin da plataforma cria cupons.";
  }
  return "Não foi possível criar o cupom agora. Tente de novo em alguns instantes.";
}

/** The link of the landing's button: the signup with the coupon in the field. */
export function couponLink(origin: string, code: string): string {
  const url = new URL("/cadastro", origin);
  url.searchParams.set("cupom", groupCode(code));
  return url.toString();
}
