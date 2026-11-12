import { billingDeps, billingWebhookToken } from "@/lib/billing/server";
import { handleWebhook } from "@/lib/billing/webhook";

/**
 * Where Asaas sends its events (#72). The answer is the status only: Asaas
 * reads nothing else, and a body would only say more than it needs to.
 * Everything that decides is in src/lib/billing/webhook.ts.
 */
export async function POST(request: Request): Promise<Response> {
  let deps;
  let token: string;
  try {
    deps = billingDeps();
    token = billingWebhookToken();
  } catch (cause) {
    // Misconfigured: a 500, so Asaas keeps the event and delivers it again
    // once the environment is fixed.
    console.error(`asaas webhook: not configured: ${String(cause)}`);
    return new Response(null, { status: 500 });
  }
  const result = await handleWebhook(
    {
      ...deps,
      token,
      log: (line) => console.error(line),
    },
    {
      tokenHeader: request.headers.get("asaas-access-token"),
      body: await request.text(),
    },
  );
  return new Response(null, { status: result.status });
}
