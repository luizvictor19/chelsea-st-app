import { after } from "next/server";

import { siteConfig } from "@/lib/current-site";
import { originAllowed, readClientReport } from "@/lib/monitoring/intake";
import { reportError } from "@/lib/monitoring/server";

/**
 * Where the browser sends an error that escaped in the tab (#69, client.ts).
 * Always 204, with no body: what is refused (an Origin from elsewhere, more
 * than 8 KB, a field beyond message, stack and route) is dropped without a
 * word, and what passes is scrubbed and recorded after the answer.
 */
export async function POST(request: Request): Promise<Response> {
  const config = siteConfig();
  const report = await readClientReport(request, (origin) =>
    originAllowed(origin, config),
  );
  if (report !== null) after(() => reportError(report));
  return new Response(null, { status: 204 });
}
