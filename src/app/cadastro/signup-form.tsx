"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { readSignupFragment } from "@/lib/founder-invite-mail";
import type { signupFounderView } from "@/lib/signup";

import { signUp, type SignupState } from "./actions";
import { TurnstileWidget } from "./turnstile-widget";

const INITIAL_STATE: SignupState = { status: "idle" };

export function SignupForm({
  siteKey,
  privacyUrl,
  founders,
}: {
  readonly siteKey: string;
  readonly privacyUrl: string;
  readonly founders: ReturnType<typeof signupFounderView>;
}) {
  const [state, formAction, isPending] = useActionState(signUp, INITIAL_STATE);
  const [hasToken, setHasToken] = useState(false);
  const coupon = state.status === "error" ? state.coupon : founders.coupon;
  const [couponOpen, setCouponOpen] = useState(coupon !== "");
  const hash = useSyncExternalStore(onHashChange, readHash, noHash);
  const fragment = readSignupFragment(hash);
  const invited = fragment.founder;
  const emailRef = useRef<HTMLInputElement>(null);

  // The link of an invite carries the address in its fragment, which the
  // server never sees (#292, #296): read here, it fills the field and, for a
  // founder invite, says when the seal comes. It decides nothing.
  useEffect(() => {
    if (fragment.email !== null && emailRef.current?.value === "") {
      emailRef.current.value = fragment.email;
    }
  }, [fragment.email]);

  if (state.status === "sent") {
    return (
      <div className="border-rule bg-surface flex flex-col gap-3 rounded-sm border p-6">
        <h2 className="text-xl font-bold tracking-tight">
          Confira o seu e-mail.
        </h2>
        <p className="text-muted">
          Mandamos um link para{" "}
          <span className="font-mono text-sm">{state.email}</span>. Se você já
          tem conta, o link é para entrar.
        </p>
        <p className="text-faint text-sm">
          Não chegou? Confira o spam. O link vale por 24 horas.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="font-semibold">
          Seu nome
        </label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          required
          autoFocus
          maxLength={120}
          defaultValue={state.status === "error" ? state.name : undefined}
          className="border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 outline-none"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="font-semibold">
          Seu e-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="voce@exemplo.com"
          ref={emailRef}
          defaultValue={state.status === "error" ? state.email : undefined}
          aria-describedby={
            state.status === "error" ? "signup-error" : undefined
          }
          className="border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 outline-none"
        />
      </div>

      {invited && founders.origin === null && (
        <p className="border-rule bg-surface rounded-sm border p-4 text-sm">
          Convite de fundadora: o selo entra quando você confirmar o e-mail.
        </p>
      )}

      {founders.origin !== null && (
        <input type="hidden" name="origin" value={founders.origin} />
      )}
      {founders.showCoupon ? (
        couponOpen ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="founder_coupon" className="font-semibold">
              Cupom de fundador
            </label>
            <input
              id="founder_coupon"
              name="founder_coupon"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={128}
              defaultValue={coupon}
              className="border-rule bg-surface focus:border-accent rounded-sm border px-4 py-3 font-mono uppercase outline-none"
            />
            <p className="text-faint text-sm">
              O selo de fundador entra quando você confirmar o e-mail, se o
              cupom valer.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCouponOpen(true)}
            className="text-muted self-start text-sm underline"
          >
            Tenho um cupom
          </button>
        )
      ) : (
        coupon !== "" && (
          <input type="hidden" name="founder_coupon" value={coupon} />
        )
      )}
      {founders.seatsEnded && (
        <p className="text-muted text-sm">
          As vagas de fundador acabaram. Você pode se cadastrar e assinar outro
          plano.
        </p>
      )}

      <TurnstileWidget
        siteKey={siteKey}
        resetKey={state}
        onToken={setHasToken}
      />

      {state.status === "error" && (
        <p id="signup-error" role="alert" className="text-accent text-sm">
          {state.message}
        </p>
      )}

      <p className="text-faint text-sm">
        Ao se cadastrar, você concorda com os{" "}
        <a
          href={privacyUrl}
          target="_blank"
          rel="noreferrer"
          className="text-muted underline"
        >
          termos de privacidade
        </a>
        .
      </p>

      <button
        type="submit"
        disabled={isPending || !hasToken}
        className="bg-accent text-accent-foreground rounded-sm px-5 py-3 font-semibold disabled:opacity-60"
      >
        {isPending ? "Enviando..." : "Cadastrar"}
      </button>
    </form>
  );
}

function onHashChange(change: () => void): () => void {
  window.addEventListener("hashchange", change);
  return () => window.removeEventListener("hashchange", change);
}

function readHash(): string {
  return window.location.hash;
}

function noHash(): string {
  return "";
}
