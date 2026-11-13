"use client";

import { useActionState } from "react";

import type { RedeemState } from "@/lib/founder-coupon";

import { redeemCoupon } from "./actions";

const INITIAL: RedeemState = { status: "idle" };

/**
 * "Tenho um cupom" for whoever has no Founder seal (#296): after the
 * signup, or with a coupon of the signup that did not count. The database
 * says why a code does not count.
 */
export function CouponForm({
  signupCouponFailed,
  seatsEnded,
}: {
  /** Her signup carried a coupon, and she has no seal. */
  readonly signupCouponFailed: boolean;
  /** No founder seat is left: no form, only the sentence. */
  readonly seatsEnded: boolean;
}) {
  const [state, formAction, isPending] = useActionState(redeemCoupon, INITIAL);

  if (seatsEnded) {
    return (
      <p className="text-muted text-sm">
        {signupCouponFailed
          ? "O cupom do cadastro não deu o selo: as vagas de fundador acabaram."
          : "As vagas de fundador acabaram."}
      </p>
    );
  }

  return (
    <form
      action={formAction}
      className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-4 text-sm"
    >
      <label htmlFor="coupon-code" className="font-semibold">
        Tenho um cupom de fundador
      </label>
      {signupCouponFailed && state.status === "idle" && (
        <p className="text-muted">
          O cupom do cadastro não valeu. Confira o código ou use outro.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          id="coupon-code"
          name="code"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          maxLength={128}
          className="border-rule bg-background focus:border-accent min-w-0 flex-1 rounded-sm border px-3 py-2 font-mono uppercase outline-none"
        />
        <button
          type="submit"
          disabled={isPending}
          className="bg-accent text-accent-foreground rounded-sm px-4 py-2 font-semibold disabled:opacity-60"
        >
          {isPending ? "Conferindo…" : "Usar cupom"}
        </button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-accent">
          {state.message}
        </p>
      )}
      {state.status === "granted" && (
        <p role="status" className="text-muted">
          {state.message}
        </p>
      )}
    </form>
  );
}
