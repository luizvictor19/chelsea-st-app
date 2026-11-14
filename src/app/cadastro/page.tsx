import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { pageMetadata } from "@/lib/brand";
import { currentSite } from "@/lib/current-site";
import { signupFounderView } from "@/lib/signup";
import { createClient } from "@/lib/supabase/server";

import { BrandMark } from "../brand-mark";
import { signupDoorHere } from "./door";
import { SignupForm } from "./signup-form";

/** The privacy terms, published on the landing (luizvictor19/chelsea-st-site). */
const PRIVACY_URL = "https://chelsea-st.com/privacidade";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(await currentSite(), "Cadastro", "/cadastro");
}

/**
 * The signup of the chelsea-st brand (#275). Only on its site: a company on GrifoAI is
 * invite only, and any other host gets a 404. Closed, with a sentence, until
 * the subscription opens and while the Turnstile keys are missing.
 *
 * ?cupom= fills "Tenho um cupom" (the landing's button, #296); ?origem=grifoai
 * (the GrifoAI landing) hides the founders and is recorded; the fragment of a
 * founder invite fills the e-mail (signup-form.tsx).
 */
export default async function SignupPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const site = await currentSite();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const door = signupDoorHere(site);
  if (door === "absent") {
    notFound();
  }
  const params = await searchParams;
  const founders = signupFounderView({
    coupon: params.cupom,
    origin: params.origem,
    seatsLeft: door === "open" ? await seatsLeft() : null,
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-3">
        <BrandMark />
        <h1 className="text-3xl font-extrabold tracking-tight">Cadastro</h1>
        <p className="text-muted">
          Com o seu nome e o seu e-mail. A senha você escolhe depois, pelo link
          que chega por e-mail.
        </p>
      </div>

      {door === "open" && siteKey ? (
        <SignupForm
          siteKey={siteKey}
          privacyUrl={PRIVACY_URL}
          founders={founders}
        />
      ) : (
        <p className="border-rule bg-surface text-muted rounded-sm border p-6">
          As inscrições abrem em breve.
        </p>
      )}

      <p className="text-muted text-sm">
        Já tem conta?{" "}
        <Link href="/login" className="text-foreground underline">
          Entrar
        </Link>
        .
      </p>
    </main>
  );
}

/** The founder seats left, the number the landing shows; null when unread. */
async function seatsLeft(): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("founder_seats_left");
  return error ? null : data;
}
