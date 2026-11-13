"use client";

import { useActionState, useState, useTransition } from "react";

import { notices } from "../notices";

import { createCoupon, endCoupon, type CouponState } from "./coupon-actions";

/** A coupon as the list shows it, decided on the server. */
export type CouponRow = {
  readonly id: string;
  readonly label: string;
  readonly uses: number;
  readonly maxUses: number;
  /** "vale até dd/mm/aaaa" or "vencido". */
  readonly validity: string;
  readonly open: boolean;
};

const INITIAL: CouponState = { status: "idle" };

const fieldClass =
  "border-rule bg-surface focus:border-accent rounded-sm border px-3 py-2 outline-none";

/** The coupons (#296): a new one, its code shown once, and the list. */
export function Coupons({
  coupons,
}: {
  readonly coupons: readonly CouponRow[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <CouponForm />
      {coupons.length === 0 ? (
        <p className="text-muted text-sm">Nenhum cupom criado ainda.</p>
      ) : (
        <ul className="border-rule divide-rule divide-y rounded-sm border">
          {coupons.map((coupon) => (
            <CouponItem key={coupon.id} coupon={coupon} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CouponForm() {
  const [state, formAction, isPending] = useActionState(createCoupon, INITIAL);
  const [kind, setKind] = useState<"general" | "personal">("general");

  return (
    <form
      action={formAction}
      className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-4 text-sm"
    >
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-2 font-semibold">Tipo de cupom</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="kind"
            value="general"
            checked={kind === "general"}
            onChange={() => setKind("general")}
          />
          Geral (você escolhe o código)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="kind"
            value="personal"
            checked={kind === "personal"}
            onChange={() => setKind("personal")}
          />
          Pessoal (código gerado, um uso)
        </label>
      </fieldset>
      <label className="flex flex-col gap-1">
        Nome do cupom (só para a lista)
        <input name="label" required maxLength={120} className={fieldClass} />
      </label>
      {kind === "general" && (
        <>
          <label className="flex flex-col gap-1">
            Código
            <input
              name="code"
              required
              autoComplete="off"
              className={`${fieldClass} font-mono uppercase`}
            />
          </label>
          <label className="flex flex-col gap-1">
            Número de usos
            <input
              name="max_uses"
              inputMode="numeric"
              required
              className={fieldClass}
            />
          </label>
        </>
      )}
      <label className="flex flex-col gap-1">
        Validade em dias
        <input
          name="days"
          inputMode="numeric"
          required
          defaultValue={30}
          className={fieldClass}
        />
      </label>
      <p className="text-muted">
        O código aparece uma vez, agora: o banco guarda só uma impressão dele, e
        a lista não o mostra de novo. Copie antes de sair da tela. Quem já tem o
        selo não gasta uso; sem vaga, o cupom não gasta uso nem dá selo.
      </p>
      <button
        type="submit"
        disabled={isPending}
        className="bg-accent text-accent-foreground self-start rounded-sm px-4 py-2 font-semibold disabled:opacity-60"
      >
        {isPending ? "Criando…" : "Criar cupom"}
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-accent">
          {state.message}
        </p>
      )}
      {state.status === "created" && <CreatedCoupon state={state} />}
    </form>
  );
}

function CreatedCoupon({
  state,
}: {
  readonly state: Extract<CouponState, { status: "created" }>;
}) {
  return (
    <div
      role="status"
      className="border-rule flex flex-col gap-2 border-t pt-3"
    >
      <p>
        Cupom <span className="font-semibold">{state.label}</span> criado. O
        código só aparece aqui:
      </p>
      <CopyLine text={state.code} />
      {state.link !== null && (
        <>
          <p className="text-muted">Link do cadastro com o cupom:</p>
          <CopyLine text={state.link} />
        </>
      )}
    </div>
  );
}

function CopyLine({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="bg-background min-w-0 rounded-sm px-2 py-1 font-mono break-all">
        {text}
      </span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        className="border-rule hover:border-foreground rounded-sm border px-3 py-1"
      >
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

function CouponItem({ coupon }: { readonly coupon: CouponRow }) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function end() {
    setConfirming(false);
    startTransition(async () => {
      const result = await endCoupon(coupon.id);
      if (result.status === "error") notices.push("error", result.message);
      else notices.push("success", `Cupom ${coupon.label} encerrado.`);
    });
  }

  return (
    <li className="flex flex-col gap-2 p-4 text-sm">
      <span className="font-semibold">{coupon.label}</span>
      <span className="text-muted">
        {coupon.uses} de {coupon.maxUses} usos · {coupon.validity}
      </span>
      {coupon.open &&
        (!confirming ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirming(true)}
            className="text-muted self-start underline disabled:opacity-60"
          >
            Encerrar cupom
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <p>
              Encerrar {coupon.label}? O código deixa de valer agora, para todo
              mundo, também para quem já se cadastrou com ele e ainda não
              confirmou o e-mail. Os selos dados por ele ficam.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={end}
                className="bg-accent text-accent-foreground rounded-sm px-3 py-1.5 font-semibold"
              >
                Sim, encerrar
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="border-rule rounded-sm border px-3 py-1.5"
              >
                Não, manter
              </button>
            </div>
          </div>
        ))}
    </li>
  );
}
