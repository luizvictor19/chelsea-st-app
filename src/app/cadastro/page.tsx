import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { billingOpen } from "@/lib/billing/server";
import { pageMetadata } from "@/lib/brand";
import { currentSite } from "@/lib/current-site";
import { signupDoor } from "@/lib/signup";

import { BrandMark } from "../brand-mark";
import { SignupForm } from "./signup-form";

/** The privacy terms, published on the landing (luizvictor19/chelsea-st-site). */
const PRIVACY_URL = "https://chelsea-st.com/privacidade";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(await currentSite(), "Cadastro", "/cadastro");
}

/**
 * The signup of Chelsea St (#275). Only on its site: a company on GrifoAI is
 * invite only, and any other host gets a 404. Closed, with a sentence, until
 * the subscription opens and while the Turnstile keys are missing.
 */
export default async function SignupPage() {
  const site = await currentSite();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const door = signupDoor(site, {
    billing: billingOpen(),
    siteKey,
    secretKey: process.env.TURNSTILE_SECRET_KEY,
  });
  if (door === "absent") {
    notFound();
  }

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
        <SignupForm siteKey={siteKey} privacyUrl={PRIVACY_URL} />
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
