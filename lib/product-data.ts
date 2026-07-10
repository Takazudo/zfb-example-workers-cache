export type Product = {
  id: string;
  name: string;
  group: string;
  priceUsd: number;
  inventory: number;
};

export type RenderWork = {
  renderedAt: string;
  durationMs: number;
};

export type Market = "us" | "eu" | "jp";

export const products: Product[] = [
  {
    id: "latte-kit",
    name: "Latte kit",
    group: "Coffee",
    priceUsd: 32,
    inventory: 18,
  },
  {
    id: "desk-mat",
    name: "Desk mat",
    group: "Workspace",
    priceUsd: 44,
    inventory: 9,
  },
  {
    id: "notebook-pack",
    name: "Notebook pack",
    group: "Paper",
    priceUsd: 18,
    inventory: 41,
  },
  {
    id: "lamp-mini",
    name: "Mini lamp",
    group: "Lighting",
    priceUsd: 58,
    inventory: 7,
  },
];

export const marketLabels: Record<Market, string> = {
  us: "United States",
  eu: "European Union",
  jp: "Japan",
};

const marketMultipliers: Record<Market, number> = {
  us: 1,
  eu: 0.93,
  jp: 155,
};

const marketCurrencies: Record<Market, string> = {
  us: "USD",
  eu: "EUR",
  jp: "JPY",
};

export async function simulateExpensiveRender(): Promise<RenderWork> {
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 180));
  return {
    renderedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}

export function normalizeMarket(value: string | null): Market {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "eu" || normalized === "jp") return normalized;
  return "us";
}

export function formatMarketPrice(product: Product, market: Market): string {
  const amount = product.priceUsd * marketMultipliers[market];
  const rounded = market === "jp" ? Math.round(amount) : amount;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: marketCurrencies[market],
    maximumFractionDigits: market === "jp" ? 0 : 2,
  }).format(rounded);
}
