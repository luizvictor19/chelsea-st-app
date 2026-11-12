/**
 * Registers the app's webhook at Asaas, or brings it up to date (#72): the
 * address, the token of ASAAS_WEBHOOK_TOKEN, the events the billing reads,
 * and the queue in order (SEQUENTIALLY). Which Asaas follows the key, as in
 * the app.
 *
 *   node scripts/asaas-webhook.ts --url https://<host>/api/asaas/webhook --email <alerts>
 *
 * The e-mail is where Asaas writes when the queue fails. Run it once per
 * environment: the sandbox points at a tunnel to a local server, never at
 * the production app, whose database is the only one (docs/context.md).
 */
import { webhookToken } from "../src/lib/billing/config.ts";
import { loadAsaasEnv, option } from "./asaas-env.ts";

const NAME = "chelsea-st-app";

export const EVENTS = [
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_UPDATED",
  "SUBSCRIPTION_INACTIVATED",
  "SUBSCRIPTION_DELETED",
  "CHECKOUT_PAID",
  "CHECKOUT_CANCELED",
  "CHECKOUT_EXPIRED",
];

const url = option("url");
const email = option("email");
if (url === null || !url.startsWith("https://") || email === null) {
  console.error(
    "Usage: node scripts/asaas-webhook.ts --url https://.../api/asaas/webhook --email <alerts>",
  );
  process.exit(1);
}

const { config, env } = loadAsaasEnv();
const token = webhookToken({ ASAAS_WEBHOOK_TOKEN: env.ASAAS_WEBHOOK_TOKEN });
if (!config.sandbox && url.includes("trycloudflare.com")) {
  console.error("A production key pointed at a tunnel: refused.");
  process.exit(1);
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      access_token: config.apiKey,
      "content-type": "application/json",
      "user-agent": "chelsea-st-app",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      `${method} ${path}: ${response.status} ${JSON.stringify(parsed.errors ?? parsed)}`,
    );
  }
  return parsed;
}

const listed = await call("GET", "/webhooks?limit=100");
const existing = (Array.isArray(listed.data) ? listed.data : []).find(
  (hook) => (hook as Record<string, unknown>).name === NAME,
) as Record<string, unknown> | undefined;

const body = {
  name: NAME,
  url,
  email,
  enabled: true,
  interrupted: false,
  apiVersion: 3,
  authToken: token,
  sendType: "SEQUENTIALLY",
  events: EVENTS,
};

const saved =
  existing === undefined
    ? await call("POST", "/webhooks", body)
    : await call("PUT", `/webhooks/${String(existing.id)}`, body);
console.log(
  `${existing === undefined ? "created" : "updated"} webhook ${String(saved.id)} on ${config.sandbox ? "sandbox" : "production"}: ${url}, ${EVENTS.length} events, SEQUENTIALLY`,
);
