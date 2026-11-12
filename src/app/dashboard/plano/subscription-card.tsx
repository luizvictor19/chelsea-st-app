"use client";

import { useActionState, useState } from "react";

import { cancel, showPix, type CancelState, type PixState } from "./actions";
import { formatCents, formatDay, STATUS_LABEL } from "./format";

const IDLE_PIX: PixState = { status: "idle" };
const IDLE_CANCEL: CancelState = { status: "idle" };

/**
 * Her subscription: what state it is in, until when, the Pix to pay, and
 * the way out. Canceling is behind a second, labelled confirmation: it ends
 * the subscription at the provider and cannot be undone from here.
 */
export function SubscriptionCard({
  planName,
  status,
  valueCents,
  cycle,
  billingType,
  firstDueOn,
  paidThrough,
  pastDueSince,
}: {
  readonly planName: string;
  readonly status: string;
  readonly valueCents: number;
  readonly cycle: "monthly" | "annual";
  readonly billingType: "card" | "pix";
  readonly firstDueOn: string;
  readonly paidThrough: string | null;
  readonly pastDueSince: string | null;
}) {
  const [pix, pixAction, pixPending] = useActionState(showPix, IDLE_PIX);
  const [canceled, cancelAction, cancelPending] = useActionState(
    cancel,
    IDLE_CANCEL,
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <section
      aria-label="Sua assinatura"
      className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-6"
    >
      <p className="text-faint font-mono text-xs tracking-[0.16em] uppercase">
        Sua assinatura
      </p>
      <p className="text-xl font-extrabold">{planName}</p>
      <p>{STATUS_LABEL[status] ?? status}</p>
      <p className="text-muted text-sm">
        {formatCents(valueCents)} {cycle === "monthly" ? "por mês" : "por ano"},
        no {billingType === "card" ? "cartão" : "Pix"}.
      </p>
      {status === "pending" && (
        <p className="text-muted text-sm">
          Assim que o pagamento confirmar o cartão, a assinatura aparece aqui.
          Saiu da página sem terminar? Assine de novo abaixo.
        </p>
      )}
      {status === "trialing" && (
        <p className="text-muted text-sm">
          Teste grátis até {formatDay(firstDueOn)} (a primeira cobrança é nesse
          dia).
        </p>
      )}
      {paidThrough !== null && status !== "canceled" && (
        <p className="text-muted text-sm">Pago até {formatDay(paidThrough)}.</p>
      )}
      {status === "past_due" && pastDueSince !== null && (
        <p role="alert" className="text-accent text-sm">
          O pagamento de {formatDay(pastDueSince)} não passou. Sem pagamento, a
          assinatura é cancelada 7 dias depois do vencimento.
        </p>
      )}

      {billingType === "pix" && status !== "canceled" && (
        <form action={pixAction} className="flex flex-col gap-2">
          <button
            type="submit"
            disabled={pixPending}
            className="border-rule self-start rounded-sm border px-4 py-2"
          >
            {pixPending ? "Buscando…" : "Ver o Pix a pagar"}
          </button>
          {pix.status === "none" && (
            <p className="text-muted text-sm">{pix.message}</p>
          )}
          {pix.status === "shown" && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">Vencimento: {formatDay(pix.dueOn)}</p>
              {/* A data URL the provider made; next/image adds nothing here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${pix.imageBase64}`}
                alt="QR Code do Pix"
                width={200}
                height={200}
              />
              <label className="flex flex-col gap-1 text-sm">
                Pix copia e cola
                <textarea
                  readOnly
                  value={pix.payload}
                  rows={3}
                  className="border-rule bg-surface rounded-sm border p-2 font-mono text-xs"
                />
              </label>
            </div>
          )}
        </form>
      )}

      {status !== "canceled" && (
        <div className="flex flex-col gap-2">
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-muted self-start text-sm underline"
            >
              Cancelar a assinatura
            </button>
          ) : (
            <form action={cancelAction} className="flex flex-col gap-2">
              <input type="hidden" name="confirm" value="sim" />
              <p className="text-sm">
                Cancelar a assinatura? Nada mais é cobrado.{" "}
                {paidThrough !== null
                  ? `Você continua com acesso até ${formatDay(paidThrough)}.`
                  : "No teste grátis, nada foi cobrado."}
              </p>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={cancelPending}
                  className="bg-accent text-on-accent rounded-sm px-4 py-2 text-sm font-semibold"
                >
                  {cancelPending ? "Cancelando…" : "Sim, cancelar a assinatura"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="border-rule rounded-sm border px-4 py-2 text-sm"
                >
                  Não, manter
                </button>
              </div>
              {canceled.status === "error" && (
                <p role="alert" className="text-accent text-sm">
                  {canceled.message}
                </p>
              )}
            </form>
          )}
        </div>
      )}
    </section>
  );
}
