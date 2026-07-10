import type { ComponentChildren } from "preact";
import renderToString from "preact-render-to-string";

import { RecipeDocument } from "../components/recipe-page";

export const NO_STORE = "no-store";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/products", label: "Products" },
  { href: "/catalog", label: "Header variant" },
];

type HtmlResponseOptions = {
  title: string;
  active: "overview" | "products" | "catalog";
  eyebrow: string;
  heading: string;
  summary: string;
  cacheControl: string;
  cacheTag?: string;
  vary?: string;
  status?: number;
  children: ComponentChildren;
};

type JsonInit = {
  status?: number;
  headers?: HeadersInit;
};

export function htmlResponse({
  title,
  active,
  eyebrow,
  heading,
  summary,
  cacheControl,
  cacheTag,
  vary,
  status = 200,
  children,
}: HtmlResponseOptions): Response {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": cacheControl,
  });

  if (cacheTag) headers.set("cache-tag", cacheTag);
  if (vary) headers.set("vary", vary);

  const html = renderToString(
    <RecipeDocument
      title={title}
      eyebrow={eyebrow}
      heading={heading}
      summary={summary}
      nav={navItems.map((item) => ({
        ...item,
        active:
          (active === "overview" && item.href === "/") ||
          (active === "products" && item.href === "/products") ||
          (active === "catalog" && item.href === "/catalog"),
      }))}
    >
      {children}
    </RecipeDocument>,
  );

  return new Response(`<!doctype html>${html}`, {
    status,
    headers,
  });
}

export function jsonResponse(body: unknown, init: JsonInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", NO_STORE);

  return new Response(JSON.stringify(body, null, 2), {
    status: init.status ?? 200,
    headers,
  });
}
