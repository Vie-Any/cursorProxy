// ─── EdgeOne Pages edge function: legacy /minimax-cn/v1/* path ───────────────
// Matches all requests under /minimax-cn/v1/... — forces provider to minimax_cn.

import { setupCompatibility, rewriteUrl } from "../../_shared/proxy.js";

export async function onRequest(context) {
  setupCompatibility(context);

  const { default: handler } = await import("../../../api/proxy.js");

  const targetUrl = rewriteUrl(context.request, "minimax_cn");
  const webRequest = new Request(targetUrl, context.request);

  return handler(webRequest);
}
