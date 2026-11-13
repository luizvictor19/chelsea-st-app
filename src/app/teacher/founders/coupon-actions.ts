"use server";

import { randomInt } from "node:crypto";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth";
import { siteOfBrand } from "@/lib/brand";
import { siteConfig } from "@/lib/current-site";
import {
  couponCreateRefusal,
  couponLink,
  groupCode,
  personalCode,
  readCouponForm,
} from "@/lib/founder-coupon";

export type CouponState =
  | { status: "idle" }
  | { status: "created"; code: string; link: string | null; label: string }
  | { status: "error"; message: string };

export type EndCouponResult =
  { status: "ended" } | { status: "error"; message: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A founder coupon (#296), through create_founder_coupon with the platform
 * admin's own client: the database hashes the code and keeps only the hash.
 * The code goes back to the screen once, now, and never again. The brand is
 * chelsea-st: the founder offer is that brand's alone (ADR 0007).
 */
export async function createCoupon(
  _previous: CouponState,
  formData: FormData,
): Promise<CouponState> {
  const { supabase } = await requirePlatformAdmin();
  const read = readCouponForm(formData);
  if (!read.ok) return { status: "error", message: read.message };
  const { values } = read;
  const code = values.code ?? personalCode(randomInt);
  const { error } = await supabase.rpc("create_founder_coupon", {
    p_code: code,
    p_label: values.label,
    p_brand: "chelsea-st",
    p_max_uses: values.maxUses,
    p_expires_at: new Date(Date.now() + values.days * DAY_MS).toISOString(),
  });
  if (error) {
    return { status: "error", message: couponCreateRefusal(error) };
  }
  revalidatePath("/teacher/founders");
  const origin = siteOfBrand("chelsea-st", siteConfig())?.origin ?? null;
  return {
    status: "created",
    code: groupCode(code),
    link: origin === null ? null : couponLink(origin, code),
    label: values.label,
  };
}

/**
 * Ends a coupon: its validity becomes now. Nothing is deleted, its uses stay
 * the record of who came by it. The list asks before sending this.
 */
export async function endCoupon(couponId: string): Promise<EndCouponResult> {
  const { supabase } = await requirePlatformAdmin();
  const { data, error } = await supabase
    .from("founder_coupons")
    .update({ expires_at: new Date().toISOString() })
    .eq("id", couponId)
    .select("id");
  revalidatePath("/teacher/founders");
  if (error || data.length === 0) {
    return {
      status: "error",
      message: "Não foi possível encerrar o cupom. A lista foi atualizada.",
    };
  }
  return { status: "ended" };
}
