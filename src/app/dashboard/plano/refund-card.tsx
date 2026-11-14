"use client";

import { useActionState, useState } from "react";

import { lastDayOf } from "@/lib/credits/summary";

import { askRefund, type RefundState } from "./actions";
import { formatCents, formatDay } from "./format";

const IDLE: RefundState = { status: "idle" };

export type RefundOffer = {
  readonly refundCents: number;
  /** The window ends at this instant (midnight in São Paulo). */
  readonly endsAt: string;
  readonly lessonsAhead: number;
};

export type RefundRequestShown = {
  readonly status: "requested" | "sent" | "done" | "failed";
  readonly refundCents: number;
};

/**
 * The withdrawal of CDC art. 49 (#297): within the 7 days after her first
 * payment, she gives up the subscription and gets back what she did not
 * use. The value is the database's. Behind a second, labelled
 * confirmation that says the value and that the subscription is canceled:
 * it cannot be undone from here.
 */
export function RefundCard({
  offer,
  request,
}: {
  readonly offer: RefundOffer | null;
  readonly request: RefundRequestShown | null;
}) {
  const [state, action, pending] = useActionState(askRefund, IDLE);
  const [confirming, setConfirming] = useState(false);

  const open = request?.status === "requested" || request?.status === "sent";
  if (offer === null && request === null) return null;

  return (
    <section
      aria-label="Desistir da assinatura"
      className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-6"
    >
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        Reembolso
      </p>

      {open && request !== null && (
        <p className="text-sm">
          Reembolso pedido: {formatCents(request.refundCents)}. Ele aparece aqui
          como feito assim que o pagamento confirmar a devolução. Até lá, os
          seus créditos ficam parados.
        </p>
      )}
      {request?.status === "done" && (
        <p className="text-sm">
          Reembolso feito: {formatCents(request.refundCents)}. No cartão, a
          devolução pode levar até 10 dias úteis para aparecer na fatura.
        </p>
      )}
      {request?.status === "failed" && (
        <p role="alert" className="text-accent text-sm">
          O último pedido de reembolso não foi feito. Tente de novo ou fale com
          a gente.
        </p>
      )}

      {offer !== null && !open && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Você pode desistir da assinatura até{" "}
            {formatDay(lastDayOf(offer.endsAt))} e receber de volta{" "}
            {formatCents(offer.refundCents)}, o valor dos créditos que não usou.
          </p>
          {offer.lessonsAhead > 0 ? (
            <p className="text-muted text-sm">
              Você tem{" "}
              {offer.lessonsAhead === 1
                ? "1 aula marcada"
                : `${offer.lessonsAhead} aulas marcadas`}
              . Cancele antes as aulas marcadas. Depois, peça o reembolso.
            </p>
          ) : !confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-muted self-start text-sm underline"
            >
              Desistir e pedir reembolso
            </button>
          ) : (
            <form action={action} className="flex flex-col gap-2">
              <input type="hidden" name="confirm" value="sim" />
              <p className="text-sm">
                Desistir da assinatura e pedir {formatCents(offer.refundCents)}{" "}
                de volta? A assinatura é cancelada, e os créditos que restam
                saem quando a devolução for feita.
              </p>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={pending}
                  className="bg-accent text-on-accent rounded-sm px-4 py-2 text-sm font-semibold"
                >
                  {pending ? "Pedindo…" : "Sim, desistir e pedir o reembolso"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="border-rule rounded-sm border px-4 py-2 text-sm"
                >
                  Não, manter
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {state.status !== "idle" && (
        <p
          role={state.status === "error" ? "alert" : undefined}
          className={
            state.status === "error" ? "text-accent text-sm" : "text-sm"
          }
        >
          {state.message}
        </p>
      )}
    </section>
  );
}
