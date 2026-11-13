/**
 * The cost form of /teacher/plans ("Custos em créditos"), read and checked
 * before the database does (credit_costs, 0050): the same rules as its
 * checks, said in Portuguese. The numbers typed here are the offer, and they
 * live only in the database (ADR 0006).
 */

import { isBrandKey, type BrandKey } from "../brand.ts";

import { isCreditAction, type CreditAction } from "./actions.ts";

/** The most an integer column holds. */
const MAX_CREDITS = 2_147_483_647;

export type CostValues = {
  readonly brand: BrandKey;
  readonly action: CreditAction;
  readonly credits: number;
};

export type CostRead =
  | { readonly ok: true; readonly values: CostValues }
  | { readonly ok: false; readonly message: string };

export function readCostForm(form: FormData): CostRead {
  const brand = form.get("brand");
  if (!isBrandKey(brand)) {
    return { ok: false, message: "Escolha a marca do custo." };
  }
  const action = form.get("action");
  if (!isCreditAction(action)) {
    return { ok: false, message: "Escolha o que o custo paga." };
  }
  const text = String(form.get("credits") ?? "").trim();
  const credits = /^\d+$/.test(text) ? Number(text) : null;
  if (credits === null || credits < 1 || credits > MAX_CREDITS) {
    return {
      ok: false,
      message: "O custo é um número inteiro de créditos, maior que zero.",
    };
  }
  return { ok: true, values: { brand, action, credits } };
}
