import type { Instrumentation } from "next";

/**
 * Every error the server captures (a render, a route, an action, the proxy)
 * goes to the error log of #69. Only the route's pattern and type and the
 * error itself are read: never request.path (it holds the query, and a
 * login link's token_hash) nor request.headers (the session cookie).
 * Awaited, as the guide asks, so the record is done before the function may
 * freeze. Everything runs in Node here; the import stays inside so no other
 * runtime ever loads it.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  _request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { serverErrorReport } = await import("./lib/monitoring/report");
  const report = serverErrorReport(error, context);
  if (report === null) return;
  const { reportError } = await import("./lib/monitoring/server");
  await reportError(report);
};
