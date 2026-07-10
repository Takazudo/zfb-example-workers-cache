import { getCloudflareContext } from "@takazudo/zfb-adapter-cloudflare";

import { CodeLine, Metric, Metrics, Panel } from "../components/recipe-page";
import { htmlResponse } from "../lib/http";
import {
  formatMarketPrice,
  marketLabels,
  normalizeMarket,
  products,
  simulateExpensiveRender,
} from "../lib/product-data";

export const prerender = false;

const CACHE_CONTROL = "public, max-age=45, stale-while-revalidate=300";
const VARY_HEADER = "X-Catalog-Market";

export default async function CatalogPage() {
  const { request } = getCloudflareContext();
  const market = normalizeMarket(request.headers.get(VARY_HEADER));
  const work = await simulateExpensiveRender();

  return htmlResponse({
    title: "Header variant - Workers Cache recipe",
    active: "catalog",
    eyebrow: `Vary: ${VARY_HEADER}`,
    heading: "One URL, separate cached variants per request header.",
    summary:
      "Workers Cache stores a distinct variant for each X-Catalog-Market value. All variants share compatible tags so a products purge clears them together.",
    cacheControl: CACHE_CONTROL,
    cacheTag: "products,catalog-market",
    vary: VARY_HEADER,
    children: (
      <>
        <Panel title="Variant metadata">
          <Metrics>
            <Metric label="Market" value={marketLabels[market]} tone="blue" />
            <Metric label="Rendered at" value={work.renderedAt} tone="green" />
            <Metric label="Simulated work" value={`${work.durationMs} ms`} tone="amber" />
          </Metrics>
        </Panel>

        <Panel title="Request header">
          <CodeLine>
            curl -H "X-Catalog-Market: jp" https://your-worker.workers.dev/catalog
          </CodeLine>
        </Panel>

        <Panel title="Market prices">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Market price</th>
                <th>Inventory</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{formatMarketPrice(product, market)}</td>
                  <td>{product.inventory}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </>
    ),
  });
}
