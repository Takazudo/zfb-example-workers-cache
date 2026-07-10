import { Metric, Metrics, Panel } from "../components/recipe-page";
import { htmlResponse } from "../lib/http";
import { products, simulateExpensiveRender } from "../lib/product-data";

export const prerender = false;

const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=600";

export default async function ProductsPage() {
  const work = await simulateExpensiveRender();

  return htmlResponse({
    title: "Products - Workers Cache recipe",
    active: "products",
    eyebrow: "Cache-Tag: products",
    heading: "Products rendered through SSR, then reused by Workers Cache.",
    summary:
      "A cache hit should keep the timestamp stable and avoid the simulated render delay until the freshness window expires or the tag is purged.",
    cacheControl: CACHE_CONTROL,
    cacheTag: "products",
    children: (
      <>
        <Panel title="Response metadata">
          <Metrics>
            <Metric label="Rendered at" value={work.renderedAt} tone="green" />
            <Metric label="Simulated work" value={`${work.durationMs} ms`} tone="amber" />
            <Metric label="Freshness" value="60 seconds" tone="blue" />
          </Metrics>
        </Panel>

        <Panel title="Products">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Group</th>
                <th>Price</th>
                <th>Inventory</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.group}</td>
                  <td>${product.priceUsd.toFixed(2)}</td>
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
