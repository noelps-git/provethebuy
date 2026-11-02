// Builds provethebuy.com into apps/site/dist: landing, pricing, security, docs (from /docs/*.md),
// the playground, and the files that help developers and search engines find it.
// Run from the repo root: npm run build:site
import { readFile, writeFile, mkdir, rm, cp, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const SITE = "https://provethebuy.com";
const APP = "https://app.provethebuy.com";
const REPO = "https://github.com/noelps-git/provethebuy";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "dist");
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- docs manifest
// Titles and descriptions are written for search: say what a developer would type.
const DOCS = [
  { group: "Get started", slug: "quickstart", file: "quickstart.md", nav: "Quickstart", title: "Quickstart: verify AI-agent orders in Node.js", description: "Install @provethebuy/verify, verify an agent's signed request at checkout in shadow mode, and read the decision. Express middleware included." },
  { group: "Get started", slug: "cli", file: "cli.md", nav: "CLI and traffic-check", title: "traffic-check CLI: count AI-agent traffic in your access logs", description: "Run npx @provethebuy/cli traffic-check on an nginx or Apache log to see how many ChatGPT, Claude and Perplexity agents hit your store and checkout." },
  { group: "Concepts", slug: "protocols", file: "protocols.md", nav: "Protocols", title: "Verifying Visa TAP, Mastercard Agent Pay, AP2 and RFC 9421 signatures", description: "Exactly what ProveTheBuy checks for each agent-commerce standard: RFC 9421, Web Bot Auth, Visa Trusted Agent Protocol, Verifiable Intent, AP2 and Stripe shared payment tokens." },
  { group: "Concepts", slug: "policy", file: "policy.md", nav: "Policy", title: "Policy: allow, step up or block agent orders", description: "Every option in the ProveTheBuy YAML policy: shadow and enforce modes, fail open, mandate handling, limits and agent reputation." },
  { group: "Concepts", slug: "architecture", file: "architecture.md", nav: "Architecture", title: "Architecture: how agent orders are verified and evidence is kept", description: "The parts of ProveTheBuy, how data moves between them, and what a hash-chained evidence record holds." },
  { group: "Concepts", slug: "flows", file: "flows.md", nav: "Flows", title: "Flows: setup, order time and dispute time", description: "Diagrams of how ProveTheBuy is set up, what happens when an agent places an order, and how a chargeback is answered months later." },
  { group: "Concepts", slug: "security", file: "security.md", nav: "Threat model", title: "Threat model for agent-order verification", description: "The threats ProveTheBuy protects against, including replays, edited requests, key rotation and over-limit orders, and how each is handled." },
  { group: "Project", slug: "roadmap", file: "roadmap.md", nav: "Roadmap", title: "Roadmap", description: "What ships next in ProveTheBuy: Python and Go verifiers, a Stripe App, and full AP2 support." },
];

// ---------------------------------------------------------------- icons (Lucide, ISC)
const ICONS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  "file-check": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M9 15l2 2 4-4"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] ?? ""}</svg>`;

const MARK = (stroke = "#EEF1F6") => `<svg viewBox="0 0 56 56" aria-hidden="true"><path d="M14 6h22l12 12v30a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="none" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/><circle cx="36" cy="16" r="3.2" fill="none" stroke="${stroke}" stroke-width="3"/><path d="M20 34l6 6 11-12" fill="none" stroke="#F28C28" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Engraved-line background, the "certificate" motif. Used on dark headers only.
function guilloche(h) {
  const lines = [];
  for (let k = 0; k < 16; k++) {
    let d = "";
    const amp = h * 0.11 + k * (h / 120);
    for (let x = 0; x <= 1440; x += 12) {
      const y = h / 2 + Math.sin(x / 90 + k * 0.38) * amp * Math.cos(x / 520 + k * 0.17);
      d += (x ? "L" : "M") + x + " " + y.toFixed(1);
    }
    lines.push(`<path d="${d}"/>`);
  }
  return `<svg class="guilloche" viewBox="0 0 1440 ${h}" preserveAspectRatio="none" aria-hidden="true" fill="none" stroke="#222A58" stroke-width="0.8">${lines.join("")}</svg>`;
}

const fill = (html) => html
  .replace(/\{\{icon:([a-z-]+)\}\}/g, (_, n) => icon(n))
  .replace(/\{\{guilloche:(\d+)\}\}/g, (_, h) => guilloche(Number(h)));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------- layout
function layout({ path, title, description, body, jsonld = [], current = "", extraHead = "", type = "website" }) {
  const url = SITE + path;
  const fullTitle = path === "/" ? title : `${title} | ProveTheBuy`;
  const navLink = (href, label, key) => `<a href="${href}"${current === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#141A3A">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="ProveTheBuy">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/og.png">
<link rel="alternate" type="text/plain" title="LLM-readable summary" href="/llms.txt">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Newsreader:opsz,wght@6..72,500;6..72,600&display=swap">
<link rel="stylesheet" href="/site.css">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
${extraHead}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap">
    <a class="logo" href="/">${MARK()}provethebuy</a>
    <button class="menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="site-nav">${icon("menu")}</button>
    <nav id="site-nav" aria-label="Main">
      ${navLink("/docs/quickstart", "Docs", "docs")}
      ${navLink("/playground", "Playground", "playground")}
      ${navLink("/pricing", "Pricing", "pricing")}
      <a class="gh" href="${REPO}">${icon("github")}GitHub</a>
      <a class="btn btn-line btn-sm" href="${APP}/login">Sign in</a>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site">
  <div class="wrap">
    <div>
      <a class="logo" href="/">${MARK()}provethebuy</a>
      <p style="margin: 14px 0 0; max-width: 30em">Open-source verification and dispute evidence for orders placed by AI agents.</p>
    </div>
    <div><h4>Developers</h4><ul>
      <li><a href="/docs/quickstart">Quickstart</a></li>
      <li><a href="/docs/cli">CLI</a></li>
      <li><a href="/docs/protocols">Protocols</a></li>
      <li><a href="/playground">Playground</a></li>
    </ul></div>
    <div><h4>Open source</h4><ul>
      <li><a href="${REPO}">GitHub</a></li>
      <li><a href="https://www.npmjs.com/package/@provethebuy/verify">npm</a></li>
      <li><a href="${REPO}/tree/main/test-vectors">Test vectors</a></li>
      <li><a href="${REPO}/blob/main/CONTRIBUTING.md">Contributing</a></li>
    </ul></div>
    <div><h4>Product</h4><ul>
      <li><a href="/pricing">Pricing</a></li>
      <li><a href="/security">Security</a></li>
      <li><a href="${APP}/login">Sign in</a></li>
      <li><a href="/llms.txt">llms.txt</a></li>
    </ul></div>
    <div class="fine"><span>Apache-2.0</span><span>provethebuy.com</span></div>
  </div>
</footer>
<script src="/site.js" defer></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- docs rendering
const slugOf = (file) => DOCS.find((d) => d.file === file)?.slug;
const idOf = (text) => text.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-");

function rewriteHref(href) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [p, hash] = href.split("#");
  const tail = hash ? "#" + hash : "";
  const base = p.replace(/^\.\//, "");
  if (base === "README.md" || base === "") return "/docs" + tail;
  const slug = slugOf(base);
  if (slug) return `/docs/${slug}${tail}`;
  if (base.startsWith("images/")) return `/docs/${base}`;
  if (base.endsWith(".md") && !base.includes("/")) return `${REPO}/blob/main/docs/${base}${tail}`;
  return `${REPO}/tree/main/${base.replace(/^(\.\.\/)+/, "")}${tail}`;
}

function markdown() {
  const m = new Marked({ gfm: true });
  m.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        return `<h${depth} id="${idOf(html)}">${html}</h${depth}>\n`;
      },
      code({ text, lang }) {
        if (lang === "mermaid") return `<pre class="mermaid">${esc(text)}</pre>\n`;
        return `<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(text)}</code></pre>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        return `<a href="${esc(rewriteHref(href))}"${title ? ` title="${esc(title)}"` : ""}>${inner}</a>`;
      },
      image({ href, text }) {
        return `<img src="${esc(rewriteHref(href))}" alt="${esc(text)}" loading="lazy">`;
      },
    },
  });
  return m;
}

function docsNav(currentSlug) {
  let html = "", group = "";
  for (const d of DOCS) {
    if (d.group !== group) { group = d.group; html += `<h4>${esc(group)}</h4>`; }
    html += `<a href="/docs/${d.slug}"${d.slug === currentSlug ? ' aria-current="page"' : ""}>${esc(d.nav)}</a>`;
  }
  return `<nav class="docs-nav" aria-label="Docs">${html}</nav>`;
}

const MERMAID = `<script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";mermaid.initialize({ startOnLoad: true, theme: "base", themeVariables: { fontFamily: "Geist, system-ui, sans-serif", primaryColor: "#EEF1F6", primaryBorderColor: "#141A3A", primaryTextColor: "#141A3A", lineColor: "#5B6478", secondaryColor: "#FBEEDF", tertiaryColor: "#FFFFFF" } });</script>`;

// ---------------------------------------------------------------- build
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const write = async (rel, content) => { const f = join(OUT, rel); await mkdir(dirname(f), { recursive: true }); await writeFile(f, content); };

// Static assets
await cp(join(HERE, "static"), OUT, { recursive: true });

// Playground (the same app as `npm run demo`, served with the /api function)
const PG = join(ROOT, "apps", "playground", "public");
for (const f of ["app.html", "app.js", "app.css", "theme.css"]) await cp(join(PG, f), join(OUT, f));

const ORG = { "@type": "Organization", name: "ProveTheBuy", url: SITE, logo: `${SITE}/favicon.svg`, sameAs: [REPO, "https://www.npmjs.com/package/@provethebuy/verify"] };
const CODE = {
  "@context": "https://schema.org", "@type": "SoftwareSourceCode", name: "ProveTheBuy",
  description: "Open-source verifier for AI-agent orders: Visa Trusted Agent Protocol, Mastercard Agent Pay and Verifiable Intent, AP2, RFC 9421 HTTP message signatures, with tamper-evident dispute evidence.",
  url: SITE, codeRepository: REPO, programmingLanguage: ["TypeScript", "JavaScript"], runtimePlatform: "Node.js 18.17+", license: "https://www.apache.org/licenses/LICENSE-2.0", author: ORG,
};
const APPLD = {
  "@context": "https://schema.org", "@type": "SoftwareApplication", name: "ProveTheBuy Cloud", applicationCategory: "BusinessApplication", operatingSystem: "Web",
  url: APP, offers: [["Free", "0"], ["Indie", "9"], ["Pro", "49"], ["Scale", "199"]].map(([name, price]) => ({ "@type": "Offer", name, price, priceCurrency: "USD" })),
};

// Landing
const indexBody = fill(await readFile(join(HERE, "pages", "index.html"), "utf8"));
const faq = [...indexBody.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/g)].map(([, q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a.replace(/<[^>]+>/g, "") } }));
await write("index.html", layout({
  path: "/", title: "ProveTheBuy: verify AI-agent orders and win the chargeback",
  description: "Open-source verifier for orders placed by AI agents. Checks Visa TAP, Mastercard Agent Pay and AP2 signatures and the shopper's signed limits at checkout, and keeps evidence for disputes.",
  body: indexBody, jsonld: [CODE, APPLD, { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq }],
}));

// Pricing and security
await write("pricing.html", layout({
  path: "/pricing", current: "pricing", title: "Pricing",
  description: "The verifier and CLI are free and open source. ProveTheBuy Cloud starts free for 1,000 verified orders a month; paid plans from $9 a month handle agent-order disputes on Stripe.",
  body: fill(await readFile(join(HERE, "pages", "pricing.html"), "utf8")), jsonld: [APPLD],
}));
await write("security.html", layout({
  path: "/security", title: "Security",
  description: "How ProveTheBuy protects your checkout: fails open, no card data, row-level isolation, hashed API keys and hash-chained evidence records.",
  body: fill(await readFile(join(HERE, "pages", "security.html"), "utf8")),
}));

// Docs
const md = markdown();
const docsDir = join(ROOT, "docs");
if (existsSync(join(docsDir, "images"))) await cp(join(docsDir, "images"), join(OUT, "docs", "images"), { recursive: true });
const full = [];
for (let i = 0; i < DOCS.length; i++) {
  const d = DOCS[i];
  const src = await readFile(join(docsDir, d.file), "utf8");
  full.push(`# ${d.title}\n\nSource: ${SITE}/docs/${d.slug}\n\n${src.replace(/^# .*\n/, "")}`);
  await write(`docs/${d.slug}.md`, src);
  const prev = DOCS[i - 1], next = DOCS[i + 1];
  const body = `<div class="wrap docs">${docsNav(d.slug)}<article class="prose">${md.parse(src)}
<div class="doc-foot"><span>${prev ? `<a href="/docs/${prev.slug}">Previous: ${esc(prev.nav)}</a>` : ""}</span><span><a href="${REPO}/edit/main/docs/${d.file}">Edit this page on GitHub</a></span><span>${next ? `<a href="/docs/${next.slug}">Next: ${esc(next.nav)}</a>` : ""}</span></div></article></div>`;
  await write(`docs/${d.slug}.html`, layout({
    path: `/docs/${d.slug}`, current: "docs", title: d.title, description: d.description, body, type: "article",
    extraHead: src.includes("```mermaid") ? MERMAID : "",
    jsonld: [
      { "@context": "https://schema.org", "@type": "TechArticle", headline: d.title, description: d.description, url: `${SITE}/docs/${d.slug}`, dateModified: TODAY, author: ORG, publisher: ORG },
      { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Docs", item: `${SITE}/docs` }, { "@type": "ListItem", position: 2, name: d.nav, item: `${SITE}/docs/${d.slug}` }] },
    ],
  }));
}
// /docs itself
const docsIndex = `<div class="wrap docs">${docsNav("")}<article class="prose"><h1>ProveTheBuy docs</h1><p>Verify orders placed by AI agents at your checkout, and keep evidence that still checks out when the dispute arrives.</p>
${DOCS.map((d) => `<h3><a href="/docs/${d.slug}">${esc(d.nav)}</a></h3><p>${esc(d.description)}</p>`).join("\n")}</article></div>`;
await write("docs.html", layout({ path: "/docs", current: "docs", title: "Docs", description: "Documentation for ProveTheBuy: quickstart, CLI, protocols, policy, architecture and threat model.", body: docsIndex }));

// 404
await write("404.html", layout({ path: "/404", title: "Page not found", description: "This page doesn't exist.", body: `<div class="page-hero">${guilloche(320)}<div class="wrap"><h1>This page isn't on file.</h1><p>It may have moved. Try the <a href="/docs" style="color:#F2B36B">docs</a> or go back to the <a href="/" style="color:#F2B36B">home page</a>.</p></div></div>` }));

// Discovery files
const pages = ["/", "/pricing", "/security", "/playground", "/docs", ...DOCS.map((d) => `/docs/${d.slug}`)];
await write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${TODAY}</lastmod></url>`).join("\n")}\n</urlset>\n`);
await write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`);
await write(".well-known/security.txt", `Contact: mailto:security@provethebuy.com\nExpires: ${new Date(Date.now() + 365 * 864e5).toISOString()}\nPreferred-Languages: en\nCanonical: ${SITE}/.well-known/security.txt\nPolicy: ${REPO}/blob/main/SECURITY.md\n`);
await write("llms.txt", `# ProveTheBuy

> Open-source verifier for orders placed by AI agents. It checks the agent's HTTP message signature (RFC 9421, Web Bot Auth, Visa Trusted Agent Protocol), the shopper's signed mandate (Mastercard Verifiable Intent, AP2) and payment token limits at checkout, then keeps a hash-chained evidence record for chargebacks. TypeScript, Node.js 18.17+, Apache-2.0, no runtime dependencies.

- Install: \`npm install @provethebuy/verify\`
- Count agent traffic in a log: \`npx @provethebuy/cli traffic-check access.log\`
- Decisions: allow, step_up, block, not_agent. Starts in shadow mode (records only) and fails open.
- ProveTheBuy Cloud (${APP}) stores records and submits dispute evidence to Stripe. The verifier works without it.

## Docs

${DOCS.map((d) => `- [${d.nav}](${SITE}/docs/${d.slug}.md): ${d.description}`).join("\n")}

## Code

- [GitHub repository](${REPO}): verifier, CLI, playground, examples
- [Express example](${REPO}/tree/main/examples/express-checkout): a runnable shop and an agent that buys from it
- [Test vectors](${REPO}/tree/main/test-vectors): signed requests with expected decisions, for ports to other languages

## Optional

- [Pricing](${SITE}/pricing)
- [Security](${SITE}/security)
- [Full docs in one file](${SITE}/llms-full.txt)
`);
await write("llms-full.txt", full.join("\n\n---\n\n"));

console.log(`Built ${pages.length} pages into ${OUT}`);
