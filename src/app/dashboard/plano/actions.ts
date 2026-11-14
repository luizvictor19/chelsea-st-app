"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { billingDay } from "@/lib/billing/dates";
import { billingDeps, billingOpen, refundNotice } from "@/lib/billing/server";
import {
  cancelSubscription,
  pixToPay,
  startSubscription,
} from "@/lib/billing/subscribe";
import { withdraw } from "@/lib/billing/withdraw";
import { siteOfBrand } from "@/lib/brand";
import { redeemAnswer, type RedeemState } from "@/lib/founder-coupon";
import { currentSite, siteConfig } from "@/lib/current-site";
import { createClient } from "@/lib/supabase/server";

import { readPlanForSale, readPlanScreen } from "./queries";

export type SubscribeState =
  { status: "idle" } | { status: "error"; message: string };

export type PixState =
  | { status: "idle" }
  | { status: "shown"; payload: string; imageBase64: string; dueOn: string }
  | { status: "none"; message: string };

export type CancelState =
  { status: "idle" } | { status: "error"; message: string };

export type RefundState =
  | { status: "idle" }
  | { status: "pending"; message: string }
  | { status: "error"; message: string };

const NOT_OPEN = "A assinatura ainda não abriu. Fale com a gente.";
const TRY_AGAIN = "Não conseguimos falar com o pagamento agora. Tente de novo.";

async function signedPerson() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Starts her subscription: the hosted checkout for a card, the Pix at once.
 * The server never marks anything paid here: the webhook does, after
 * reading the provider (#72).
 */
export async function subscribe(
  _previous: SubscribeState,
  formData: FormData,
): Promise<SubscribeState> {
  const user = await signedPerson();
  if (!billingOpen()) return { status: "error", message: NOT_OPEN };

  const plan = await readPlanForSale(
    String(formData.get("plan") ?? ""),
    user.id,
  );
  if (plan === null) {
    return { status: "error", message: "Escolha um plano." };
  }
  const cycle = formData.get("cycle") === "annual" ? "annual" : "monthly";
  const billingType = formData.get("billingType") === "pix" ? "pix" : "card";

  const site = (await currentSite()) ?? siteOfBrand("chelsea-st", siteConfig());
  if (site === null) return { status: "error", message: NOT_OPEN };

  let result;
  try {
    result = await startSubscription(billingDeps(), {
      personId: user.id,
      name: String(formData.get("name") ?? ""),
      email: user.email ?? "",
      cpf: String(formData.get("cpf") ?? ""),
      plan,
      cycle,
      billingType,
      today: billingDay(new Date()),
      returnUrl: `${site.origin}/dashboard/plano`,
    });
  } catch (cause) {
    console.error(`subscribe ${user.id}: ${String(cause)}`);
    return { status: "error", message: TRY_AGAIN };
  }
  if (result.kind === "refused")
    return { status: "error", message: result.message };
  if (result.kind === "checkout") redirect(result.url);
  revalidatePath("/dashboard/plano");
  return { status: "idle" };
}

/** The Pix of the charge she has to pay now. */
export async function showPix(): Promise<PixState> {
  const user = await signedPerson();
  const { current } = await readPlanScreen(user.id);
  if (current === null || current.status === "canceled") {
    return { status: "none", message: "Nenhuma assinatura ativa." };
  }
  try {
    const pix = await pixToPay(billingDeps().provider, current);
    return pix === null
      ? { status: "none", message: "Nenhum Pix a pagar agora." }
      : { status: "shown", ...pix };
  } catch (cause) {
    console.error(`pix ${user.id}: ${String(cause)}`);
    return { status: "none", message: TRY_AGAIN };
  }
}

/**
 * Ends her subscription. The form sends confirm=sim only after she said yes
 * on the screen; anything else changes nothing.
 */
export async function cancel(
  _previous: CancelState,
  formData: FormData,
): Promise<CancelState> {
  const user = await signedPerson();
  if (formData.get("confirm") !== "sim") return { status: "idle" };
  const { current } = await readPlanScreen(user.id);
  if (current === null || current.status === "canceled") {
    revalidatePath("/dashboard/plano");
    return { status: "idle" };
  }
  try {
    const deps = billingDeps();
    await cancelSubscription(deps, current);
  } catch (cause) {
    console.error(`cancel ${user.id}: ${String(cause)}`);
    return { status: "error", message: TRY_AGAIN };
  }
  revalidatePath("/dashboard/plano");
  return { status: "idle" };
}

/**
 * The withdrawal of CDC art. 49 (#297): the refund of what she did not use,
 * and the subscription canceled once the provider took it. The form sends
 * confirm=sim only after she said yes to the value on the screen. The
 * database decides the window and the value (0060), never the form.
 */
export async function askRefund(
  _previous: RefundState,
  formData: FormData,
): Promise<RefundState> {
  const user = await signedPerson();
  if (formData.get("confirm") !== "sim") return { status: "idle" };
  if (!billingOpen()) return { status: "error", message: NOT_OPEN };
  const { current } = await readPlanScreen(user.id);
  let result;
  try {
    result = await withdraw(
      {
        ...billingDeps(),
        notify: refundNotice,
        log: (line) => console.error(line),
      },
      { personId: user.id, current },
    );
  } catch (cause) {
    console.error(`refund ${user.id}: ${String(cause)}`);
    return { status: "error", message: TRY_AGAIN };
  }
  revalidatePath("/dashboard/plano");
  if (result.kind === "refused") {
    return { status: "error", message: result.message };
  }
  if (result.kind === "pending") {
    return {
      status: "pending",
      message:
        "Pedido enviado. A resposta do pagamento demorou: confira aqui em alguns minutos.",
    };
  }
  return { status: "idle" };
}

/**
 * "Tenho um cupom" (#296): redeem_my_founder_coupon decides, for her and
 * nobody else (auth.uid() in the database), and every refusal comes back by
 * the name of its rule. With the seal, the Plano Fundador is hers to read.
 */
export async function redeemCoupon(
  _previous: RedeemState,
  formData: FormData,
): Promise<RedeemState> {
  await signedPerson();
  const code = String(formData.get("code") ?? "").trim();
  if (code === "") {
    return { status: "error", message: "Digite o código do cupom." };
  }
  const supabase = await createClient();
  const answer = await supabase.rpc("redeem_my_founder_coupon", {
    p_code: code.slice(0, 128),
  });
  const state = redeemAnswer(answer);
  if (state.status === "granted") revalidatePath("/dashboard/plano");
  return state;
}
