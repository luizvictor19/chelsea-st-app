/**
 * Which Asaas this environment talks to, from the key alone.
 *
 * A sandbox key starts with $aact_hmlg_ and a production key with
 * $aact_prod_ (docs.asaas.com, "Autenticação", read 12/11/2026). The address
 * follows the key, so there is no second variable to disagree with it.
 *
 * Two mistakes this refuses by name rather than letting them through:
 *
 * - An empty key. Next's env loader expands $NAME, and a key written
 *   ASAAS_API_KEY=$aact_... in .env.local is read as an empty string
 *   (measured on 12/11/2026). The fix is ASAAS_API_KEY=\$aact_...
 * - The sandbox key in Vercel Production. There is one database, production
 *   (docs/context.md), and a sandbox event must never write into it.
 */

export type AsaasConfig = {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly sandbox: boolean;
};

export const SANDBOX_URL = "https://api-sandbox.asaas.com/v3";
export const PRODUCTION_URL = "https://api.asaas.com/v3";

export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigError";
  }
}

export function asaasConfig(env: {
  ASAAS_API_KEY?: string;
  VERCEL_ENV?: string;
}): AsaasConfig {
  const apiKey = env.ASAAS_API_KEY ?? "";
  if (apiKey === "") {
    throw new BillingConfigError(
      "ASAAS_API_KEY is empty. In .env.local write it as ASAAS_API_KEY=\\$aact_... : Next reads $aact_ as a variable.",
    );
  }
  let sandbox: boolean;
  if (apiKey.startsWith("$aact_hmlg_")) sandbox = true;
  else if (apiKey.startsWith("$aact_prod_")) sandbox = false;
  else {
    throw new BillingConfigError(
      "ASAAS_API_KEY does not start with $aact_hmlg_ or $aact_prod_.",
    );
  }
  if (sandbox && env.VERCEL_ENV === "production") {
    throw new BillingConfigError(
      "The Asaas sandbox key is refused in Vercel Production: the database is production.",
    );
  }
  return { apiKey, baseUrl: sandbox ? SANDBOX_URL : PRODUCTION_URL, sandbox };
}

/** The webhook's shared secret; refused when too short to be one. */
export function webhookToken(env: { ASAAS_WEBHOOK_TOKEN?: string }): string {
  const token = env.ASAAS_WEBHOOK_TOKEN ?? "";
  // Asaas takes 32 to 255 characters (docs, "Criar novo Webhook pela API").
  if (token.length < 32 || token.length > 255) {
    throw new BillingConfigError(
      "ASAAS_WEBHOOK_TOKEN must have 32 to 255 characters (openssl rand -hex 32).",
    );
  }
  return token;
}

export function cpfKey(env: { BILLING_CPF_KEY?: string }): string {
  const key = env.BILLING_CPF_KEY ?? "";
  if (key.length < 32) {
    throw new BillingConfigError(
      "BILLING_CPF_KEY must have at least 32 characters (openssl rand -hex 32).",
    );
  }
  return key;
}
