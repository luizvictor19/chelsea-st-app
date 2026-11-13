import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { studies } from "@/lib/access";
import { readAccess } from "@/lib/auth";
import { founderLine } from "@/lib/badges";
import { billingDay } from "@/lib/billing/dates";
import { billingOpen } from "@/lib/billing/server";
import { createClient } from "@/lib/supabase/server";

import { CreditsCard } from "./credits-card";
import { formatDay } from "./format";
import { readCredits, readPlanScreen } from "./queries";
import { SubscribeForm } from "./subscribe-form";
import { SubscriptionCard } from "./subscription-card";

export const metadata: Metadata = {
  title: "Plano e pagamento",
};

/**
 * Her plan and its payment (#72), for a student of the B2C line (brand
 * chelsea-st). A company's employee never pays here (#274): the billing
 * refuses anyone who is not a student of a chelsea-st organization, and this
 * screen says so instead of offering a form.
 */
export default async function PlanPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [access, { data: profile }, { data: chelsea }] = await Promise.all([
    readAccess(supabase, user.id),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("organization_members")
      .select("organizations!inner(brand)")
      .eq("user_id", user.id)
      .eq("role", "student")
      .eq("organizations.brand", "chelsea-st")
      .limit(1),
  ]);
  if (!studies(access)) redirect("/dashboard");

  const header = (
    <div className="flex flex-col gap-2">
      <Link href="/dashboard" className="text-muted text-sm underline">
        Voltar
      </Link>
      <h1 className="text-3xl font-extrabold tracking-tight">
        Plano e pagamento
      </h1>
    </div>
  );

  if ((chelsea ?? []).length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 p-6">
        {header}
        <p className="text-muted">
          O seu acesso vem da sua empresa. Não há nada a pagar aqui.
        </p>
      </main>
    );
  }

  const [{ plans, current, pastDueSince, trialUsed, seal }, credits] =
    await Promise.all([readPlanScreen(user.id), readCredits(user.id)]);
  // ?plano=<id>: the checkout of that plan open (the personal plan's way in,
  // from the front door). A plan she may not read is simply not there.
  const asked = typeof params.plano === "string" ? params.plano : null;
  const chosen = plans.find((each) => each.id === asked)?.id ?? null;
  const today = billingDay(new Date());
  const alive = current !== null && current.status !== "canceled";
  // A checkout left unfinished does not hold the door: subscribing again
  // replaces it, and a checkout paid after that is undone by the webhook.
  const canSubscribe = !alive || current?.status === "pending";
  const plan = plans.find((each) => each.id === current?.planId);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 p-6">
      {header}

      {seal !== null && (
        <p className="border-rule bg-surface rounded-sm border p-4 text-sm">
          {founderLine(seal.grantedAt)}
        </p>
      )}

      <CreditsCard summary={credits} />

      {alive && current !== null && (
        <SubscriptionCard
          planName={plan?.name ?? "Seu plano"}
          status={current.status}
          valueCents={current.valueCents}
          cycle={current.cycle}
          billingType={current.billingType}
          firstDueOn={current.firstDueOn}
          paidThrough={current.paidThrough}
          pastDueSince={pastDueSince}
        />
      )}

      {current?.status === "canceled" &&
        current.paidThrough !== null &&
        current.paidThrough >= today && (
          <p className="text-muted">
            Assinatura cancelada. Você tem acesso até{" "}
            {formatDay(current.paidThrough)}.
          </p>
        )}

      {current?.status === "canceled" &&
        current.cancelReason === "trial_used" && (
          <p role="alert" className="text-accent">
            O pagamento no cartão foi feito com outro CPF, ou sem CPF, e a
            assinatura não foi criada. Nada foi cobrado. Assine de novo e use no
            pagamento o mesmo CPF informado aqui.
          </p>
        )}

      {canSubscribe &&
        (!billingOpen() || plans.length === 0 ? (
          <p className="text-muted">
            A assinatura ainda não abriu. Fale com a gente.
          </p>
        ) : (
          <SubscribeForm
            plans={plans}
            chosenPlanId={chosen}
            // One trial per person (Q4): a second subscription has none.
            trialDays={
              !trialUsed && (plans[0]?.trialDays ?? 0) > 0
                ? plans[0].trialDays
                : null
            }
            defaultName={profile?.full_name ?? ""}
          />
        ))}
    </main>
  );
}
