/**
 * The billing as the server runs it: the real provider, the store over the
 * billing functions, the mailer, read from the environment. Every piece is
 * built on the call, so a page that never bills never reads a billing key,
 * and the build in CI runs without them.
 */

import { CHELSEA } from "@/lib/brand";

import { createResendMailer, type Mailer } from "../mail/mailer.ts";
import { createServiceClient } from "../supabase/service.ts";

import { createAsaasProvider } from "./asaas.ts";
import { asaasConfig, cpfKey, webhookToken } from "./config.ts";
import type { BillingStore } from "./store.ts";
import { createSupabaseBillingStore } from "./supabase-store.ts";
import type { SyncDeps } from "./sync.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "billing/server.ts is server only and must not reach the browser",
  );
}

/** The address the billing e-mails come from: the brand's, on its domain. */
const FROM = `${CHELSEA.name} <contato@chelsea-st.com>`;

/**
 * Whether this environment sells at all. Before the CNPJ the production has
 * no Asaas key (the #72 plan, "Ambientes"), and the plan screen says the
 * subscription has not opened yet instead of failing.
 */
export function billingOpen(): boolean {
  try {
    asaasConfig({
      ASAAS_API_KEY: process.env.ASAAS_API_KEY,
      VERCEL_ENV: process.env.VERCEL_ENV,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    });
    return true;
  } catch {
    return false;
  }
}

export function billingDeps(): SyncDeps {
  return {
    provider: createAsaasProvider(
      asaasConfig({
        ASAAS_API_KEY: process.env.ASAAS_API_KEY,
        VERCEL_ENV: process.env.VERCEL_ENV,
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      }),
    ),
    store: createSupabaseBillingStore(),
    cpfKey: cpfKey({ BILLING_CPF_KEY: process.env.BILLING_CPF_KEY }),
  };
}

/**
 * The store alone, without the provider: the credits' daily step runs also
 * where billing is not open (closing a lot needs no Asaas key).
 */
export function billingStore(): BillingStore {
  return createSupabaseBillingStore();
}

export function billingWebhookToken(): string {
  return webhookToken({ ASAAS_WEBHOOK_TOKEN: process.env.ASAAS_WEBHOOK_TOKEN });
}

export function billingMailer(): Mailer {
  return createResendMailer({
    apiKey: process.env.RESEND_API_KEY ?? "",
    from: FROM,
  });
}

/** A person's e-mail, from auth, for the overdue e-mails. */
export async function emailOf(personId: string): Promise<string | null> {
  const { data, error } =
    await createServiceClient().auth.admin.getUserById(personId);
  if (error)
    throw new Error(
      `could not read the e-mail of ${personId}: ${error.message}`,
    );
  return data.user?.email ?? null;
}
