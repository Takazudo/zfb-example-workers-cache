import type { ComponentChildren } from "preact";

type NavItem = {
  href: string;
  label: string;
  active?: boolean;
};

type RecipeDocumentProps = {
  title: string;
  eyebrow: string;
  heading: string;
  summary: string;
  nav: NavItem[];
  children: ComponentChildren;
};

type MetricProps = {
  label: string;
  value: string;
  tone?: "green" | "blue" | "amber" | "rose";
};

type PanelProps = {
  title: string;
  children: ComponentChildren;
};

const pageStyles = `
  :root {
    color-scheme: light;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f8faf9;
    color: #17211c;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    min-width: 320px;
    background:
      linear-gradient(180deg, #f8faf9 0%, #eef5f1 54%, #f7f7fb 100%);
    color: #17211c;
  }

  a {
    color: inherit;
  }

  .page {
    width: min(1120px, calc(100% - 32px));
    margin-inline: auto;
    padding-block: 24px 48px;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-block: 12px 20px;
    border-block-end: 1px solid #d8e2dc;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 0.95rem;
    font-weight: 700;
    text-decoration: none;
  }

  .brand-mark {
    display: inline-grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 1px solid #16734d;
    border-radius: 8px;
    color: #16734d;
  }

  .nav {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .nav a {
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    border: 1px solid #cfd9d3;
    border-radius: 8px;
    padding-inline: 12px;
    font-size: 0.88rem;
    font-weight: 650;
    text-decoration: none;
    background: rgba(255, 255, 255, 0.64);
  }

  .nav a[aria-current="page"] {
    border-color: #16734d;
    background: #e5f5ed;
    color: #0f5d3d;
  }

  .intro {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.55fr);
    gap: 28px;
    align-items: end;
    padding-block: 40px 28px;
  }

  .eyebrow {
    margin: 0 0 10px;
    color: #0f6b47;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  h1 {
    max-width: 820px;
    margin: 0;
    font-size: 2.4rem;
    line-height: 1.05;
    letter-spacing: 0;
  }

  .summary {
    max-width: 760px;
    margin: 16px 0 0;
    color: #45524b;
    font-size: 1rem;
    line-height: 1.7;
  }

  .stack {
    display: grid;
    gap: 16px;
  }

  .panel {
    border: 1px solid #d7e0da;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.78);
  }

  .panel > header {
    border-block-end: 1px solid #e1e8e3;
    padding: 14px 16px;
  }

  .panel h2 {
    margin: 0;
    font-size: 1rem;
    letter-spacing: 0;
  }

  .panel-body {
    padding: 16px;
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr));
    gap: 12px;
  }

  .metric {
    min-height: 96px;
    border: 1px solid #d8e0db;
    border-radius: 8px;
    padding: 14px;
    background: #ffffff;
  }

  .metric span {
    display: block;
    color: #607068;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .metric strong {
    display: block;
    margin-block-start: 8px;
    color: #17211c;
    font-size: 1.35rem;
    line-height: 1.2;
  }

  .metric.green {
    border-color: #9ed7b7;
    background: #eefaf3;
  }

  .metric.blue {
    border-color: #acc7f7;
    background: #eef4ff;
  }

  .metric.amber {
    border-color: #e8c482;
    background: #fff8e8;
  }

  .metric.rose {
    border-color: #f2b8c5;
    background: #fff1f4;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.94rem;
  }

  th,
  td {
    padding: 12px;
    border-block-end: 1px solid #e3e9e5;
    text-align: start;
  }

  th {
    color: #52645a;
    font-size: 0.78rem;
    text-transform: uppercase;
  }

  code,
  .code-line {
    border: 1px solid #dbe4df;
    border-radius: 6px;
    background: #f4f7f5;
    color: #18392b;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 0.9rem;
  }

  code {
    padding: 2px 5px;
  }

  .code-line {
    display: block;
    overflow-x: auto;
    padding: 10px 12px;
    white-space: nowrap;
  }

  .note {
    border-inline-start: 4px solid #2563eb;
    padding: 12px 14px;
    background: #eef4ff;
    color: #223453;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-block-start: 18px;
  }

  .button {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
    border: 1px solid #16734d;
    border-radius: 8px;
    padding-inline: 14px;
    background: #16734d;
    color: #fff;
    font-weight: 700;
    text-decoration: none;
  }

  .button.secondary {
    border-color: #cbd7d0;
    background: #fff;
    color: #17211c;
  }

  @media (max-width: 760px) {
    .page {
      width: min(100% - 24px, 1120px);
      padding-block-start: 12px;
    }

    .topbar,
    .intro {
      grid-template-columns: 1fr;
    }

    .topbar {
      align-items: flex-start;
      flex-direction: column;
    }

    .nav {
      justify-content: flex-start;
    }

    h1 {
      font-size: 2rem;
    }

    th,
    td {
      padding-inline: 8px;
    }
  }
`;

export function RecipeDocument({
  title,
  eyebrow,
  heading,
  summary,
  nav,
  children,
}: RecipeDocumentProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      </head>
      <body>
        <div class="page">
          <header class="topbar">
            <a class="brand" href="/">
              <span class="brand-mark">C</span>
              <span>Workers Cache recipe</span>
            </a>
            <nav class="nav" aria-label="Primary">
              {nav.map((item) => (
                <a key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}>
                  {item.label}
                </a>
              ))}
            </nav>
          </header>
          <main>
            <section class="intro">
              <div>
                <p class="eyebrow">{eyebrow}</p>
                <h1>{heading}</h1>
                <p class="summary">{summary}</p>
              </div>
            </section>
            <div class="stack">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}

export function Panel({ title, children }: PanelProps) {
  return (
    <section class="panel">
      <header>
        <h2>{title}</h2>
      </header>
      <div class="panel-body">{children}</div>
    </section>
  );
}

export function Metrics({ children }: { children: ComponentChildren }) {
  return <div class="metrics">{children}</div>;
}

export function Metric({ label, value, tone = "green" }: MetricProps) {
  return (
    <div class={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function CodeLine({ children }: { children: ComponentChildren }) {
  return <code class="code-line">{children}</code>;
}

export function Note({ children }: { children: ComponentChildren }) {
  return <div class="note">{children}</div>;
}
