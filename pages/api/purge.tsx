import { getCloudflareContext } from "@takazudo/zfb-adapter-cloudflare";

import { jsonResponse } from "../../lib/http";

export const prerender = false;

type Env = {
  PURGE_TOKEN?: string;
};

type CachePurgeResult = {
  success: boolean;
  errors: Array<{
    code: number;
    message: string;
  }>;
};

type WorkersCacheContext = {
  purge(options: { tags: string[] }): Promise<CachePurgeResult>;
};

type CacheAwareExecutionContext = {
  cache?: WorkersCacheContext;
};

const encoder = new TextEncoder();

export default async function PurgeRoute() {
  const { env, ctx, request } = getCloudflareContext<Env>();

  if (request.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "method_not_allowed", allowed: ["POST"] },
      { status: 405, headers: { allow: "POST" } },
    );
  }

  const expectedToken = env.PURGE_TOKEN;
  if (!expectedToken) {
    return jsonResponse(
      {
        ok: false,
        error: "missing_purge_token",
        detail: "Set PURGE_TOKEN with wrangler secret put.",
      },
      { status: 503 },
    );
  }

  const suppliedToken = request.headers.get("x-purge-token") ?? "";
  if (!timingSafeEqual(suppliedToken, expectedToken)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // The adapter currently exposes a minimal ctx type. Cloudflare's current
  // runtime types include ctx.cache, so this local widening is intentionally
  // narrow and limited to the purge API this route needs.
  const cache = (ctx as CacheAwareExecutionContext).cache;
  if (!cache) {
    return jsonResponse(
      {
        ok: false,
        error: "cache_context_unavailable",
        detail: "ctx.cache is unavailable in this runtime. Deploy to Workers to verify purge.",
      },
      { status: 501 },
    );
  }

  const result = await cache.purge({ tags: ["products"] });
  if (!result.success) {
    return jsonResponse({ ok: false, error: "purge_failed", result }, { status: 502 });
  }

  return jsonResponse({
    ok: true,
    purged: { tags: ["products"] },
    result,
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }

  return diff === 0;
}
