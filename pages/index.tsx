import "../styles/global.css";

import { CodeLine, Metric, Metrics, Note, Panel } from "../components/recipe-page";
import { htmlResponse, NO_STORE } from "../lib/http";

export const prerender = false;

export default function OverviewPage() {
  return htmlResponse({
    title: "Workers Cache recipe",
    active: "overview",
    eyebrow: "SSR on Cloudflare Workers",
    heading: "A compact zfb recipe for response-header driven caching.",
    summary:
      "The cached routes do a small amount of request-time work, stamp the render time, and let Workers Cache decide reuse from HTTP headers.",
    cacheControl: NO_STORE,
    children: (
      <>
        <Panel title="Routes">
          <Metrics>
            <Metric label="Cached page" value="/products" tone="green" />
            <Metric label="Header variant" value="/catalog" tone="blue" />
            <Metric label="Purge endpoint" value="POST /api/purge" tone="amber" />
          </Metrics>
        </Panel>

        <Panel title="Cache controls">
          <p>
            <code>/products</code> returns a cacheable HTML response with a <code>products</code>{" "}
            tag. <code>/catalog</code> varies by <code>X-Catalog-Market</code> and uses compatible
            tags so the same purge clears every variant.
          </p>
          <CodeLine>Cache-Control: public, max-age=60, stale-while-revalidate=600</CodeLine>
        </Panel>

        <Panel title="Purge">
          <Note>
            Set <code>PURGE_TOKEN</code> as a Worker secret, then call <code>POST /api/purge</code>{" "}
            with <code>X-Purge-Token</code>. The route uses <code>ctx.cache.purge()</code> with the{" "}
            <code>products</code> tag.
          </Note>
          <div class="actions">
            <a class="button" href="/products">
              Open products
            </a>
            <a class="button secondary" href="/catalog">
              Open catalog
            </a>
          </div>
        </Panel>
      </>
    ),
  });
}
