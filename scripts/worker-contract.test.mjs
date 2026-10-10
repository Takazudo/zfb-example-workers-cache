import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../dist/_worker.js";

const token = "local-test-token";
const env = {
  PURGE_TOKEN: token,
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
};
const context = { waitUntil() {}, passThroughOnException() {} };
const request = (path, init) => new Request(`https://cache.example.test${path}`, init);
const fetchWorker = (path, init, bindings = env, ctx = context) =>
  worker.fetch(request(path, init), bindings, ctx);

for (const [path, control, tags, market] of [
  ["/", "no-store", null],
  ["/products", "public, max-age=60, stale-while-revalidate=600", "products"],
  ["/catalog", "public, max-age=45, stale-while-revalidate=300", "products,catalog-market", "jp"],
  ["/catalog", "public, max-age=45, stale-while-revalidate=300", "products,catalog-market", "eu"],
]) {
  test(`built Worker header contract: ${path} ${market ?? ""}`, async () => {
    const response = await fetchWorker(path, { headers: market ? { "X-Catalog-Market": market } : {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), control);
    assert.equal(response.headers.get("cache-tag"), tags);
    assert.equal(response.headers.get("vary"), market ? "X-Catalog-Market" : null);
    assert.match(response.headers.get("content-type"), /text\/html/);
    const html = await response.text();
    assert.match(html, /^<!doctype html>/i);
    if (market) assert.ok(html.includes(market === "jp" ? "Japan" : "European Union"));
  });
}

test("asset hit, asset miss and unknown-route fallback", async () => {
  const hit = await fetchWorker("/asset.txt", {}, {
    ASSETS: { fetch: async () => new Response("asset hit") },
  });
  assert.equal(await hit.text(), "asset hit");
  assert.equal((await fetchWorker("/missing")).status, 404);
  const styled = await fetchWorker("/missing", {}, {
    ASSETS: { fetch: async () => new Response("<h1>Not found</h1>", {
      status: 404, headers: { "content-type": "text/html" },
    }) },
  });
  assert.equal(styled.status, 404);
  assert.equal(await styled.text(), "<h1>Not found</h1>");
});

test("purge method, configuration, authentication and runtime branches", async () => {
  const cases = [
    [{}, env, context, 405, "method_not_allowed"],
    [{ method: "POST" }, {}, context, 503, "missing_purge_token"],
    [{ method: "POST", headers: { "X-Purge-Token": "wrong" } }, env, context, 401, "unauthorized"],
    [{ method: "POST", headers: { "X-Purge-Token": token } }, env, context, 501, "cache_context_unavailable"],
  ];
  for (const [init, bindings, ctx, status, error] of cases) {
    const response = await fetchWorker("/api/purge", init, bindings, ctx);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    if (status === 405) assert.equal(response.headers.get("allow"), "POST");
    assert.equal((await response.json()).error, error);
  }
  for (const success of [true, false]) {
    const calls = [];
    const result = { success, errors: success ? [] : [{ code: 1, message: "test failure" }] };
    const response = await fetchWorker("/api/purge", {
      method: "POST", headers: { "X-Purge-Token": token },
    }, env, { ...context, cache: { purge: async (options) => { calls.push(options); return result; } } });
    assert.equal(response.status, success ? 200 : 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(calls, [{ tags: ["products"] }]);
    const body = await response.json();
    assert.equal(body.ok, success);
    assert.deepEqual(body.result, result);
  }
});

// A deliberately limited test double for header-driven reuse, not Cloudflare's
// edge cache: real HIT/MISS, TTL and stale revalidation require deployment.
function cacheHarness() {
  const entries = [];
  let renders = 0;
  const ctx = { ...context, cache: { async purge({ tags }) {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (tags.some((tag) => entries[i].tags.includes(tag))) entries.splice(i, 1);
    }
    return { success: true, errors: [] };
  } } };
  return {
    get renders() { return renders; },
    async fetch(path, init) {
      const req = request(path, init);
      const hit = req.method === "GET" && entries.find((entry) =>
        entry.url === req.url && entry.vary.every(([key, value]) => req.headers.get(key) === value));
      if (hit) return { state: "HIT", response: hit.response.clone() };
      renders++;
      const response = await worker.fetch(req, env, ctx);
      const control = response.headers.get("cache-control") ?? "";
      if (req.method === "GET" && response.ok && control.includes("public") && !control.includes("no-store")) {
        entries.push({ url: req.url, response: response.clone(),
          tags: (response.headers.get("cache-tag") ?? "").split(","),
          vary: (response.headers.get("vary") ?? "").split(",").map((key) => key.trim()).filter(Boolean)
            .map((key) => [key, req.headers.get(key)]),
        });
      }
      return { state: "MISS", response };
    },
  };
}

test("simulated reuse preserves URL/header keys and tag purge invalidates all variants", async () => {
  const cache = cacheHarness();
  const first = await cache.fetch("/products");
  assert.equal(first.state, "MISS");
  const before = cache.renders;
  const second = await cache.fetch("/products");
  assert.equal(second.state, "HIT");
  assert.equal(cache.renders, before);
  assert.equal(await first.response.text(), await second.response.text());
  assert.equal((await cache.fetch("/products?variant=2")).state, "MISS");
  for (const market of ["jp", "eu"]) {
    const init = { headers: { "X-Catalog-Market": market } };
    const miss = await cache.fetch("/catalog", init);
    assert.equal(miss.state, "MISS");
    assert.ok((await miss.response.text()).includes(market === "jp" ? "Japan" : "European Union"));
    assert.equal((await cache.fetch("/catalog", init)).state, "HIT");
  }
  assert.equal((await cache.fetch("/")).state, "MISS");
  assert.equal((await cache.fetch("/")).state, "MISS");
  const purged = await cache.fetch("/api/purge", { method: "POST", headers: { "X-Purge-Token": token } });
  assert.equal(purged.response.status, 200);
  for (const path of ["/products", "/products?variant=2"]) assert.equal((await cache.fetch(path)).state, "MISS");
  for (const market of ["jp", "eu"]) {
    assert.equal((await cache.fetch("/catalog", { headers: { "X-Catalog-Market": market } })).state, "MISS");
  }
});
