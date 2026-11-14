/**
 * The environment of the Asaas scripts, read the way the app reads it
 * (@next/env, which expands $NAME), so a key written ASAAS_API_KEY=\$aact_...
 * in .env.local means the same to both. node --env-file would read the
 * backslash as part of the key.
 */
import nextEnv from "@next/env";

import { asaasConfig, type AsaasConfig } from "../src/lib/billing/config.ts";

export function loadAsaasEnv(): {
  config: AsaasConfig;
  env: NodeJS.ProcessEnv;
} {
  nextEnv.loadEnvConfig(process.cwd(), true, {
    info: () => {},
    error: console.error,
  });
  return {
    config: asaasConfig({
      ASAAS_API_KEY: process.env.ASAAS_API_KEY,
      VERCEL_ENV: process.env.VERCEL_ENV,
    }),
    env: process.env,
  };
}

export function option(name: string): string | null {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at < 0) return null;
  const value = args[at + 1];
  return value === undefined || value.startsWith("--") ? null : value;
}
