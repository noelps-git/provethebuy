// Playground lab: pick a store, send an agent, see what the merchant gets, try to break it,
// then jump 40 days to the dispute. Every request is signed and checked by the real
// @provethebuy/verify code. Keys here are demo keys made for the playground only.
import { ProveTheBuy, KeyDirectory, MemoryReplayStore, EvidenceLedger, buildEvidencePack, KNOWN_DIRECTORIES, formatMoney, orderHash } from "@provethebuy/verify";
import { createAgent, generateKey, checkoutRequest, buildVerifiableIntent, buildAafPresentation } from "@provethebuy/verify/testing";

// ------------------------------------------------------------------ the demo world

const ISSUER = generateKey("lab-bank-issuer-k1", "lab-issuer");
const PERSON = generateKey("lab-shopper-device-k1", "lab-person");
const ID_DIRECTORY = generateKey("lab-aaf-directory-k1", "lab-aaf-dir");

const AGENT_KEYS = {
  visa: { ...createAgent("ShopAssist", "lab-shopassist"), directory: "visa" },
  mastercard: { ...createAgent("CartPilot", "lab-cartpilot"), directory: "mastercard" },
  wba: { ...createAgent("Orbit", "lab-orbit"), directory: "web-bot-auth" },
  unlisted: { ...createAgent("Unlisted Bot", "lab-unlisted"), directory: null },
};

export const STORES = {
  sneakers: {
    id: "sneakers",
    name: "Stride Supply",
    kind: "Running shoes",
    merchant: "acct_stride_supply",
    origin: "https://stride.example",
    catalog: [
      { sku: "trail-9", name: "Trail runner, size 9", unit_amount: 11400 },
      { sku: "trail-10", name: "Trail runner, size 10", unit_amount: 11400 },
      { sku: "racer-9", name: "Carbon racer, size 9", unit_amount: 13900 },
    ],
    ask: { sku: "trail-9", cap: 12000, text: "Running shoes, size 9, under $120" },
    swap: { sku: "trail-10", text: "size 10 instead of size 9" },
    upsell: { sku: "racer-9", text: "a $139 pair, over the $120 cap" },
    returnPolicy: "Free returns within 30 days, unworn.",
  },
  flights: {
    id: "flights",
    name: "SkyFare",
    kind: "Flights",
    merchant: "acct_skyfare",
    origin: "https://skyfare.example",
    catalog: [
      { sku: "del-sfo-am", name: "DEL to SFO, 23 Nov, 08:40, economy", unit_amount: 64000 },
      { sku: "del-sfo-pm", name: "DEL to SFO, 23 Nov, 21:15, economy", unit_amount: 59000 },
      { sku: "del-sfo-prem", name: "DEL to SFO, 23 Nov, 08:40, premium economy", unit_amount: 128000 },
    ],
    ask: { sku: "del-sfo-am", cap: 70000, text: "DEL to SFO, 23 Nov, morning departure, under $700" },
    swap: { sku: "del-sfo-pm", text: "the 21:15 evening flight, not a morning one" },
    upsell: { sku: "del-sfo-prem", text: "premium economy at $1,280, over the $700 cap" },
    returnPolicy: "Refundable within 24 hours of booking.",
  },
  electronics: {
    id: "electronics",
    name: "Voltline",
    kind: "Electronics",
    merchant: "acct_voltline",
    origin: "https://voltline.example",
    catalog: [
      { sku: "anc-black", name: "Noise-cancelling headphones, black", unit_amount: 22900 },
      { sku: "anc-white", name: "Noise-cancelling headphones, white", unit_amount: 22900 },
      { sku: "anc-pro", name: "Noise-cancelling headphones Pro, black", unit_amount: 34900 },
    ],
    ask: { sku: "anc-black", cap: 25000, text: "Noise-cancelling headphones, black, under $250" },
    swap: { sku: "anc-white", text: "the white pair instead of black" },
    upsell: { sku: "anc-pro", text: "the $349 Pro model, over the $250 cap" },
    returnPolicy: "Returns within 14 days in original packaging.",
  },
};

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const AGENTS = [
  { id: "visa", name: "ShopAssist", how: "Signs with Visa Trusted Agent Protocol", level: "verified" },
  { id: "mastercard", name: "CartPilot", how: "Signs with Mastercard Agent Pay", level: "verified" },
  { id: "wba", name: "Orbit", how: "Signs with Web Bot Auth", level: "verified" },
  { id: "named", name: "Named only", how: "Writes an agent name in the User-Agent, no signature", level: "declared" },
  { id: "stealth", name: "Stealth agent", how: "No name, no signature: looks like ordinary Chrome", level: "none" },
  { id: "human", name: "A person", how: "A real shopper on Chrome", level: "none" },
];

export const APPROVALS = [
  { id: "passkey", name: "Passkey on their phone", detail: "The shopper signed the limits with a key on their own device." },
  { id: "chat", name: "Said yes in the agent's chat", detail: "The agent recorded the yes and signed the approval itself." },
  { id: "none", name: "No approval", detail: "Nothing shows what the shopper allowed." },
];

export const ATTACKS = [
  { id: "none", group: "Normal", name: "Normal order", detail: "The agent buys exactly what was asked." },
  { id: "swap", group: "Agent misbehaves", name: "Agent changes the item", detail: "After approval, the agent buys a different variant and signs it again." },
  { id: "over", group: "Agent misbehaves", name: "Agent goes over budget", detail: "The agent picks a pricier item above the shopper's cap." },
  { id: "self_approve", group: "Agent misbehaves", name: "Agent approves itself", detail: "The approval is signed with the agent's own key instead of the shopper's." },
  { id: "tamper", group: "Request tampering", name: "Change the price after signing", detail: "Someone edits the order in transit to $1." },
  { id: "wrong_path", group: "Request tampering", name: "Send it somewhere else", detail: "Signed for /checkout, sent to /admin/refund." },
  { id: "other_merchant", group: "Request tampering", name: "Order for another store", detail: "The order names a different merchant." },
  { id: "replay", group: "Stolen requests", name: "Replay the request", detail: "A captured valid request is sent a second time." },
  { id: "expired", group: "Stolen requests", name: "Use an old signature", detail: "The signature window closed an hour ago." },
  { id: "unknown_key", group: "Stolen requests", name: "Unknown agent key", detail: "Signed by a key no trusted directory lists." },
  { id: "strip", group: "Stolen requests", name: "Remove the signature", detail: "Strip the signature headers so it looks like a normal browser." },
  { id: "lifted_id", group: "Agent ID", name: "Borrowed agent ID", detail: "Present an AAF ID that was issued to a different agent." },
  { id: "id_limit", group: "Agent ID", name: "Over the ID's spending limit", detail: "The AAF ID allows $50; the order is larger." },
  { id: "revoked_id", group: "Agent ID", name: "Revoked agent ID", detail: "The directory has revoked this ID." },
];

const SIGNED = new Set(["visa", "mastercard", "wba"]);
const REVOKED = new Set(["aaf_lab_revoked"]);

function verifierFor(store, mode, replay) {
  const dir = (d) => Object.values(AGENT_KEYS).filter((a) => a.directory === d).map((a) => a.publicJwk);
  return new ProveTheBuy({
    merchantId: store.merchant,
    keys: new KeyDirectory({
      sources: [
        { name: "visa", jwks: { keys: dir("visa") } },
        { name: "mastercard", jwks: { keys: dir("mastercard") } },
        { name: "web-bot-auth", jwks: { keys: dir("web-bot-auth") } },
      ],
    }),
    issuers: new KeyDirectory({ sources: [{ name: "demo-bank", jwks: { keys: [ISSUER.publicJwk] } }] }),
    agentIds: new KeyDirectory({ sources: [{ name: "demo-aaf-directory", jwks: { keys: [ID_DIRECTORY.publicJwk] } }] }),
    isAgentIdRevoked: (id) => REVOKED.has(id),
    replay: replay ?? new MemoryReplayStore(),
    // Flights are large unattended purchases; raise the step-up threshold so a normal booking is allowed.
    policy: { mode, approval: { on_self_approved: "step_up" }, limits: { intent_mandate_max_order: 200000 } },
  });
}

const item = (store, sku) => {
  const p = store.catalog.find((c) => c.sku === sku);
  return { sku: p.sku, name: p.name, qty: 1, unit_amount: p.unit_amount };
};
const orderFor = (store, sku, merchant = store.merchant) => {
  const i = item(store, sku);
  return { id: "ord_" + Math.random().toString(36).slice(2, 10), merchant_id: merchant, currency: "usd", total: i.unit_amount, items: [i] };
};

// ------------------------------------------------------------------ one run

export function normaliseSpec(spec = {}) {
  const store = STORES[spec.store] ? spec.store : "sneakers";
  const agent = AGENTS.some((a) => a.id === spec.agent) ? spec.agent : "visa";
  const approval = APPROVALS.some((a) => a.id === spec.approval) ? spec.approval : "passkey";
  const attack = ATTACKS.some((a) => a.id === spec.attack) ? spec.attack : "none";
  const mode = spec.mode === "enforce" ? "enforce" : "shadow";
  const cap = Number.isFinite(+spec.cap) && +spec.cap > 0 ? Math.round(+spec.cap) : STORES[store].ask.cap;
  const withId = !!spec.withId || attack.endsWith("_id") || attack === "id_limit";
  const reason = ["10.4", "13.3", "4837"].includes(spec.reason) ? spec.reason : "10.4";
  return { store, agent, approval, attack, mode, cap, withId, reason };
}

export async function run(specIn) {
  const spec = normaliseSpec(specIn);
  const store = STORES[spec.store];
  const now = Math.floor(Date.now() / 1000);
  const notes = [];
  const approvedOrder = orderFor(store, store.ask.sku);
  let order = approvedOrder;
  let approval = spec.attack === "self_approve" ? "chat" : spec.approval;

  // ---------------------------------------------------------------- unsigned clients
  if (!SIGNED.has(spec.agent)) {
    const ua = spec.agent === "named" ? "Mozilla/5.0 (compatible; Claude-User/1.0; +https://www.anthropic.com)" : CHROME_UA;
    const req = checkoutRequest(store.origin, { order, payment: paymentFor(store, order, now) });
    req.headers["user-agent"] = ua;
    if (spec.agent === "stealth" || spec.agent === "human")
      notes.push(
        "From the server, the stealth agent and the person send the same thing. Arkose Labs saw 66% of AI agent sessions look like ordinary Chrome in the week of 16 to 22 November 2026, and nearly half carried no name or signature at all. Only behaviour and device signals can tell these apart, which is why ProveTheBuy hands them to your existing fraud tools instead of guessing.",
      );
    if (spec.agent === "named") notes.push("A name in the User-Agent is a claim. Anyone can type it. ProveTheBuy notes it but treats the request as unverified.");
    return finish({ spec, store, req, verifyTimes: 1, notes, approvedOrder, order });
  }

  // ---------------------------------------------------------------- signed agents
  const agentKey = spec.attack === "unknown_key" ? AGENT_KEYS.unlisted : AGENT_KEYS[spec.agent];
  const userKey = approval === "chat" ? agentKey : PERSON;
  const constraints = { allowed_merchants: [store.merchant], max_amount: { amount: spec.cap, currency: "usd" } };
  const vi = (o, presented) =>
    buildVerifiableIntent({ issuer: ISSUER, user: userKey, agent: agentKey, order: o, constraints, mode: "autonomous", now, presentedTransactionId: presented });

  let mandate;
  if (spec.attack === "swap") {
    order = orderFor(store, store.swap.sku);
    // The agent presents the checkout the shopper approved, but sends a different order.
    mandate = approval === "none" ? undefined : vi(order, orderHash(approvedOrder));
  } else if (spec.attack === "over") {
    order = orderFor(store, store.upsell.sku);
    mandate = approval === "none" ? undefined : vi(order);
  } else if (spec.attack === "other_merchant") {
    order = orderFor(store, store.ask.sku, otherStore(store).merchant);
    mandate = approval === "none" ? undefined : vi(order);
  } else {
    mandate = approval === "none" ? undefined : vi(order);
  }

  const body = { order, payment: paymentFor(store, order, now) };
  if (mandate) body.mandate = mandate;
  if (spec.withId) {
    const idKey = spec.attack === "lifted_id" ? AGENT_KEYS[spec.agent === "visa" ? "mastercard" : "visa"] : agentKey;
    body.agent_id = buildAafPresentation({
      directory: ID_DIRECTORY,
      agent: idKey,
      id: spec.attack === "revoked_id" ? "aaf_lab_revoked" : "aaf_" + store.id + "_" + Math.random().toString(36).slice(2, 8),
      audience: store.merchant,
      assurance: "IAL2",
      spendingLimit: { amount: spec.attack === "id_limit" ? 5000 : 200000, currency: "usd" },
      now,
    });
  }

  let req = checkoutRequest(store.origin, body);
  req.headers["user-agent"] = "Mozilla/5.0 (compatible; " + agentKey.name + "/1.0)";
  const signOpts = spec.attack === "expired" ? { created: now - 3900, expires: now - 3600 } : { created: now - 2 };
  req = agentKey.sign(req, signOpts);

  if (spec.attack === "tamper") {
    const t = JSON.parse(req.body);
    t.order.items[0].unit_amount = 100;
    t.order.total = 100;
    req = { ...req, body: JSON.stringify(t) };
    notes.push("The signature covers the host and path, not the body, so the edit gets past it. The shopper's signed approval names the exact order, though, and the edited order no longer matches it.");
  }
  if (spec.attack === "wrong_path") req = { ...req, url: store.origin + "/admin/refund" };
  if (spec.attack === "strip") {
    const h = { ...req.headers };
    delete h["signature"];
    delete h["signature-input"];
    h["user-agent"] = CHROME_UA;
    req = { ...req, headers: h };
    notes.push(
      "Without its signature, the request looks like a person on Chrome, so it falls through to your normal fraud checks. That is a real limit of any signature scheme: it only helps when agents opt in. For checkout, the protection is the other way round: a merchant can require a verified agent and a signed approval for agent-placed orders, so stripping the signature loses the agent its fast lane instead of gaining it anything.",
    );
  }
  return finish({ spec, store, req, verifyTimes: spec.attack === "replay" ? 2 : 1, notes, approvedOrder, order });
}


const otherStore = (store) => Object.values(STORES).find((s) => s.id !== store.id);

function paymentFor(store, order, now) {
  return {
    type: "stripe-spt",
    token: "spt_demo_" + Math.random().toString(36).slice(2, 10),
    allowance: { max_amount: Math.max(order.total * 2, 300000), currency: "usd", merchant_id: store.merchant, expires_at: now + 3600 },
  };
}

async function finish({ spec, store, req, verifyTimes, notes, approvedOrder, order }) {
  const replay = new MemoryReplayStore();
  const v = verifierFor(store, spec.mode, replay);
  let result;
  for (let i = 0; i < verifyTimes; i++) result = await v.verify(req);
  if (verifyTimes > 1) notes.push("The first copy went through. This is the second copy, sent with the same nonce.");

  let context;
  try {
    context = req.body ? JSON.parse(req.body) : undefined;
  } catch {
    context = undefined;
  }
  const ledger = new EvidenceLedger(store.merchant);
  const placed = spec.mode === "shadow" || result.decision === "allow" || result.decision === "not_agent";
  const rec = ledger.record(result, { request: req, context, paymentIntent: placed && context?.order ? "pi_demo_" + Math.random().toString(36).slice(2, 10) : undefined });

  const attack = ATTACKS.find((a) => a.id === spec.attack);
  const verdict = judge(spec, result);
  const dispute = context?.order && placed ? await disputeView(spec, store, rec, ledger, context.order) : null;

  return {
    spec,
    store: { id: store.id, name: store.name, merchant: store.merchant, ask: { ...store.ask, cap: spec.cap } },
    attack,
    approved_order: approvedOrder,
    sent_order: order,
    request: { method: req.method, url: req.url, headers: req.headers, body: context ?? req.body ?? null },
    result: {
      decision: result.decision,
      enforced: result.enforced,
      reasons: result.reasons,
      checks: result.checks.map((c) => ({ name: c.name, status: c.status, detail: c.detail })),
      identification: result.identification,
      declared_as: result.declaredAs ?? null,
      agent: result.agent ?? null,
      mandate: result.mandate ?? null,
    },
    shopper: shopperView(spec, result, context?.order),
    record: { ...rec, artifacts: undefined },
    verdict,
    notes,
    dispute,
    code: codeFor(spec, store, req),
  };
}

/** Did the attack get caught, and by which check? */
function judge(spec, result) {
  if (spec.attack === "none") return { kind: "normal" };
  const failed = result.checks.filter((c) => c.status === "fail").map((c) => c.name);
  if (spec.attack === "strip") return { kind: "known_limit", caught_by: [], text: "Falls back to your existing fraud tools." };
  if (result.decision === "allow") return { kind: "gap", caught_by: [], text: "This attack got through. Please tell us." };
  if (result.decision === "not_agent") return { kind: "gap", caught_by: [], text: "This attack was treated as normal traffic." };
  return { kind: "caught", caught_by: failed, text: `Caught: ${result.decision === "block" ? "blocked" : "sent for the shopper's confirmation"}.` };
}

function shopperView(spec, result, order) {
  const total = order ? formatMoney(order.total, order.currency) : "";
  if (spec.mode === "shadow") {
    return {
      status: 200,
      title: "Order placed",
      body: `Watch-only mode: the order for ${total} goes through as normal. ProveTheBuy recorded "${result.decision}" in the evidence log without affecting the shopper.`,
    };
  }
  switch (result.decision) {
    case "allow":
      return { status: 200, title: "Order placed", body: `The agent's order for ${total} is accepted and the evidence record is filed.` };
    case "step_up":
      return { status: 409, title: "Confirm this purchase", body: `The shopper gets a prompt on their own device to approve ${total}. The order waits until they do.` };
    case "block":
      return { status: 403, title: "Order refused", body: "The agent gets a 403 with the reason. Nothing is charged." };
    default:
      return { status: 200, title: "Normal checkout", body: "Treated as a regular shopper and passed to your existing fraud checks." };
  }
}

// ------------------------------------------------------------------ 40 days later

const DISPUTE_REASONS = {
  "10.4": "I didn't make this purchase",
  "13.3": "This isn't what I asked for",
  "4837": "I never authorised this",
};

async function disputeView(spec, store, rec, ledger, order) {
  const opened = new Date(Date.now() + 40 * 86400e3);
  const v = verifierFor(store, spec.mode);
  const pack = await buildEvidencePack(rec, { dispute_id: "dp_demo_" + rec.record_id.slice(-6), reason_code: spec.reason, amount: order.total, currency: order.currency }, ledger, {
    merchantId: store.merchant,
    issuers: v["opts"].issuers,
    policy: v.policy,
  });
  const ip = "203.0.113." + (10 + Math.floor(Math.random() * 200));
  return {
    opened_at: opened.toISOString(),
    claim: DISPUTE_REASONS[spec.reason],
    reason_label: pack.reason,
    amount: formatMoney(order.total, order.currency),
    without: [
      ["Order", `${order.id}, ${formatMoney(order.total, order.currency)}`],
      ["Payment", "Card token ending 4242"],
      ["IP address", ip],
      ["Placed at", new Date(rec.received_at).toUTCString()],
      ["Return policy", store.returnPolicy],
      ["Who placed it", "Unknown"],
      ["What the shopper approved", "Unknown"],
    ],
    with: pack.sections,
    submittable: pack.submittable,
    flagged_but_placed:
      spec.mode === "shadow" && rec.decision !== "allow" && rec.decision !== "not_agent"
        ? `In watch-only mode, ProveTheBuy flagged this order as "${rec.decision.replace("_", " ")}" but let it through. In enforce mode it would have ${rec.decision === "block" ? "been refused" : "waited for the shopper to confirm"}, and this dispute would never have happened.`
        : null,
    verdict: pack.submittable
      ? "You can show which agent placed the order, that the shopper approved it with their own key, and that the order matched what they approved."
      : "The record shows what happened, but it does not prove the shopper approved this order. Expect to lose this one, or refund it.",
    return_policy_at_purchase: store.returnPolicy,
  };
}

// ------------------------------------------------------------------ copy as code

function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function codeFor(spec, store, req) {
  const express = `import express from "express";
import { ProveTheBuy, KeyDirectory, KNOWN_DIRECTORIES, FileLedger } from "@provethebuy/verify";
import { createMiddleware } from "@provethebuy/verify/express";

const ptb = new ProveTheBuy({
  merchantId: "${store.merchant}",
  keys: new KeyDirectory({ sources: [{ name: "visa", url: KNOWN_DIRECTORIES.visa }] }),${spec.withId ? `
  agentIds: new KeyDirectory({ sources: [{ name: "your-aaf-directory", url: "https://directory.example/.well-known/jwks.json" }] }),` : ""}
  policy: {
    mode: "${spec.mode}",                       // ${spec.mode === "shadow" ? "record decisions, never block" : "apply decisions: 409 step-up, 403 block"}
    approval: { on_self_approved: "step_up" },  // the agent cannot approve its own purchase
    limits: { intent_mandate_max_order: 200000 }, // step up unattended orders above $2,000
  },
});

const agents = createMiddleware(ptb, new FileLedger("${store.merchant}", "evidence.jsonl"));
const app = express();

// capture() must come before any body parser, so the bytes stay exactly as signed.
app.post("/checkout", agents.capture(), agents.verify(), (req, res) => {
  const paymentIntent = chargeTheCustomer(req);   // your existing payment code
  agents.record(req, { paymentIntent });          // file the evidence record
  res.json({ ok: true, decision: req.provethebuy.decision });
});

app.listen(3000);`;
  const headerFlags = Object.entries(req.headers)
    .filter(([k]) => k !== "host")
    .map(([k, v]) => `  -H ${shellQuote(`${k}: ${v}`)}`)
    .join(" \\\n");
  const curl = `curl -X ${req.method} ${shellQuote(req.url)} \\\n${headerFlags}${req.body ? ` \\\n  --data ${shellQuote(req.body)}` : ""}`;
  return { install: "npm install @provethebuy/verify", express, curl };
}

// ------------------------------------------------------------------ bring your own agent

const BLOCKED_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|metadata\.)/i;

function safeJwksUrl(u) {
  if (!u) return null;
  let url;
  try {
    url = new URL(u);
  } catch {
    throw Object.assign(new Error("Key directory URL is not a valid URL."), { status: 400 });
  }
  if (url.protocol !== "https:") throw Object.assign(new Error("Key directory URL must use https."), { status: 400 });
  if (BLOCKED_HOST.test(url.hostname)) throw Object.assign(new Error("Key directory URL must be a public host."), { status: 400 });
  return url.toString();
}

const timedFetch = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(4000) });

function liveVerifier(merchantId, jwksUrl) {
  const sources = [
    { name: "visa", url: KNOWN_DIRECTORIES.visa },
    ...(jwksUrl ? [{ name: "your-directory", url: jwksUrl }] : []),
    { name: "playground-demo", jwks: { keys: Object.values(AGENT_KEYS).filter((a) => a.directory).map((a) => a.publicJwk) } },
  ].filter((s) => s.url || s.jwks);
  return new ProveTheBuy({
    merchantId: merchantId || "acct_playground_sandbox",
    keys: new KeyDirectory({ sources, fetch: timedFetch }),
    issuers: new KeyDirectory({ sources: [{ name: "demo-bank", jwks: { keys: [ISSUER.publicJwk] } }] }),
    agentIds: new KeyDirectory({ sources: [{ name: "demo-aaf-directory", jwks: { keys: [ID_DIRECTORY.publicJwk] } }] }),
    policy: { mode: "shadow" },
  });
}

const slim = (r) => ({
  decision: r.decision,
  reasons: r.reasons,
  identification: r.identification,
  declared_as: r.declaredAs ?? null,
  agent: r.agent ?? null,
  mandate: r.mandate ?? null,
  checks: r.checks.map((c) => ({ name: c.name, status: c.status, detail: c.detail })),
});

export async function verifyRaw({ request, jwksUrl, merchantId }) {
  if (!request?.method || !request?.url) throw Object.assign(new Error("Send { request: { method, url, headers, body } }."), { status: 400 });
  const req = {
    method: String(request.method).toUpperCase(),
    url: String(request.url),
    headers: Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])),
    body: typeof request.body === "string" ? request.body : request.body ? JSON.stringify(request.body) : undefined,
  };
  return slim(await liveVerifier(merchantId, safeJwksUrl(jwksUrl)).verify(req));
}

// Sandbox sessions: an endpoint a developer can point a real agent at. In-memory per server
// instance; set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to share across instances.
const SESSIONS = new Map();
const MAX_EVENTS = 25;
const TTL_MS = 3600e3;

async function upstash(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return undefined;
  try {
    const r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(2000) });
    return (await r.json()).result;
  } catch {
    return undefined;
  }
}

export function createSession({ jwksUrl, merchantId } = {}) {
  for (const [k, s] of SESSIONS) if (Date.now() - s.created > TTL_MS) SESSIONS.delete(k);
  const id = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  SESSIONS.set(id, { created: Date.now(), jwksUrl: safeJwksUrl(jwksUrl), merchantId, events: [] });
  upstash(["SET", `pg:sb:${id}:cfg`, JSON.stringify({ jwksUrl: safeJwksUrl(jwksUrl), merchantId }), "EX", 3600]);
  return { id, path: `/api/lab/sandbox/${id}/checkout`, expires_in_seconds: 3600 };
}

async function sessionConfig(id) {
  const s = SESSIONS.get(id);
  if (s) return s;
  const cfg = await upstash(["GET", `pg:sb:${id}:cfg`]);
  if (!cfg) return null;
  const parsed = JSON.parse(cfg);
  const fresh = { created: Date.now(), ...parsed, events: [] };
  SESSIONS.set(id, fresh);
  return fresh;
}

export async function receiveSandbox(id, req, rawBody) {
  const s = await sessionConfig(id);
  if (!s) throw Object.assign(new Error("Sandbox session not found or expired. Create a new one in the playground."), { status: 404 });
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(", ") : String(v)]));
  const request = { method: req.method, url: `${proto}://${host}${req.url}`, headers, body: rawBody || undefined };
  const result = slim(await liveVerifier(s.merchantId, s.jwksUrl).verify(request));
  const event = { at: new Date().toISOString(), method: req.method, path: new URL(request.url).pathname, user_agent: headers["user-agent"] ?? "", result };
  s.events.unshift(event);
  s.events.length = Math.min(s.events.length, MAX_EVENTS);
  await upstash(["LPUSH", `pg:sb:${id}:ev`, JSON.stringify(event)]);
  await upstash(["LTRIM", `pg:sb:${id}:ev`, 0, MAX_EVENTS - 1]);
  await upstash(["EXPIRE", `pg:sb:${id}:ev`, 3600]);
  return { received: true, decision: result.decision, reasons: result.reasons, identification: result.identification };
}

export async function sandboxEvents(id) {
  const shared = await upstash(["LRANGE", `pg:sb:${id}:ev`, 0, MAX_EVENTS - 1]);
  if (Array.isArray(shared)) return shared.map((e) => JSON.parse(e));
  const s = SESSIONS.get(id);
  if (!s) throw Object.assign(new Error("Sandbox session not found or expired."), { status: 404 });
  return s.events;
}

// ------------------------------------------------------------------ analytics

const COUNTS = new Map();
const EVENT_NAMES = new Set(["run", "attack", "dispute_view", "copy_code", "copy_curl", "share", "install_click", "gap_report", "sandbox_create", "raw_verify"]);

export async function track(name, props = {}) {
  if (!EVENT_NAMES.has(name)) return;
  COUNTS.set(name, (COUNTS.get(name) ?? 0) + 1);
  console.log(JSON.stringify({ kind: "playground_event", name, props, at: new Date().toISOString() }));
  await upstash(["HINCRBY", "pg:events", name, 1]);
}

export async function stats() {
  const shared = await upstash(["HGETALL", "pg:events"]);
  if (Array.isArray(shared) && shared.length) {
    const o = {};
    for (let i = 0; i < shared.length; i += 2) o[shared[i]] = Number(shared[i + 1]);
    return { source: "shared", counts: o };
  }
  return { source: "this-instance", counts: Object.fromEntries(COUNTS) };
}

// ------------------------------------------------------------------ routes

export function catalog() {
  return {
    stores: Object.values(STORES).map((s) => ({ id: s.id, name: s.name, kind: s.kind, ask: s.ask, catalog: s.catalog, swap: s.swap, upsell: s.upsell })),
    agents: AGENTS,
    approvals: APPROVALS,
    attacks: ATTACKS,
    reasons: Object.entries(DISPUTE_REASONS).map(([code, claim]) => ({ code, claim })),
  };
}

export async function labRoute(req, res, url, { body, json }) {
  const p = url.pathname;
  const m = req.method;
  const fail = (e) => json(res, e.status ?? 500, { error: e.message });
  try {
    if (m === "GET" && p === "/api/lab/catalog") return json(res, 200, catalog());
    if (m === "POST" && p === "/api/lab/run") {
      const spec = JSON.parse((await body(req)) || "{}");
      const out = await run(spec);
      track(spec.attack && spec.attack !== "none" ? "attack" : "run", { store: out.spec.store, agent: out.spec.agent, attack: out.spec.attack, decision: out.result.decision });
      return json(res, 200, out);
    }
    if (m === "POST" && p === "/api/lab/verify-raw") {
      const out = await verifyRaw(JSON.parse((await body(req)) || "{}"));
      track("raw_verify", { decision: out.decision });
      return json(res, 200, out);
    }
    if (m === "POST" && p === "/api/lab/sandbox") {
      const out = createSession(JSON.parse((await body(req)) || "{}"));
      track("sandbox_create");
      return json(res, 200, out);
    }
    let mm;
    if (m === "GET" && (mm = p.match(/^\/api\/lab\/sandbox\/([a-z0-9]+)\/events$/))) return json(res, 200, await sandboxEvents(mm[1]));
    if ((mm = p.match(/^\/api\/lab\/sandbox\/([a-z0-9]+)(\/.*)?$/))) return json(res, 200, await receiveSandbox(mm[1], req, await body(req)));
    if (m === "POST" && p === "/api/lab/event") {
      const { name, props } = JSON.parse((await body(req)) || "{}");
      await track(String(name), props && typeof props === "object" ? props : {});
      return json(res, 200, { ok: true });
    }
    if (m === "GET" && p === "/api/lab/stats") return json(res, 200, await stats());
    return json(res, 404, { error: "Unknown playground endpoint." });
  } catch (e) {
    return fail(e);
  }
}
