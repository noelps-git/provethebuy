// Demo world for the local playground: agents, keys, scenarios and a day of simulated traffic.
// Every request is signed and verified by the real @provethebuy/verify code.
import { ProveTheBuy, KeyDirectory, MemoryReplayStore, ledgerReputation } from "@provethebuy/verify";
import { createAgent, generateKey, checkoutRequest, buildVerifiableIntent, buildAp2Cart, buildAp2Intent, signBodyObject } from "@provethebuy/verify/testing";

export const MERCHANT_ID = "acct_northwind_coffee";
export const ORIGIN = "https://shop.northwind.example";

export const AGENTS = {
  shopassist: { ...createAgent("ShopAssist", "pg-shopassist"), label: "ShopAssist", directory: "visa" },
  cartpilot: { ...createAgent("CartPilot", "pg-cartpilot"), label: "CartPilot", directory: "mastercard" },
  orbit: { ...createAgent("Orbit Buyer", "pg-orbit"), label: "Orbit Buyer", directory: "visa" },
  stranger: { ...createAgent("Unlisted Bot", "pg-stranger"), label: "Unlisted Bot", directory: null },
};
export const ISSUER = generateKey("northbank-issuer-k1", "pg-issuer");
export const USERS = [generateKey("user-ana-k1", "pg-user-ana"), generateKey("user-ravi-k1", "pg-user-ravi"), generateKey("user-mei-k1", "pg-user-mei")];
export const MERCHANT_KEY = generateKey("northwind-merchant-k1", "pg-merchant");

export const CATALOG = [
  { sku: "beans-1kg", name: "House espresso beans, 1 kg", unit_amount: 3200 },
  { sku: "beans-250g", name: "Single-origin Ethiopia, 250 g", unit_amount: 1450 },
  { sku: "grinder-c40", name: "Hand grinder C40", unit_amount: 24900 },
  { sku: "filters-100", name: "Paper filters, 100 pack", unit_amount: 650 },
  { sku: "kettle-pour", name: "Pour-over kettle", unit_amount: 8900 },
];

export function directories() {
  const byDir = (d) => Object.values(AGENTS).filter((a) => a.directory === d).map((a) => a.publicJwk);
  return {
    keys: new KeyDirectory({ sources: [{ name: "visa", jwks: { keys: byDir("visa") } }, { name: "mastercard", jwks: { keys: byDir("mastercard") } }] }),
    issuers: new KeyDirectory({ sources: [{ name: "northbank", jwks: { keys: [ISSUER.publicJwk] } }] }),
  };
}

export function makeVerifier({ policy, ledger, replay, now }) {
  const { keys, issuers } = directories();
  return new ProveTheBuy({
    merchantId: MERCHANT_ID,
    keys,
    issuers,
    merchantJwk: MERCHANT_KEY.publicJwk,
    replay: replay ?? new MemoryReplayStore(),
    policy,
    reputation: ledger ? ledgerReputation(ledger) : undefined,
    now,
  });
}

const pick = (arr, r) => arr[Math.floor(r() * arr.length)];
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function makeOrder(r, opts = {}) {
  const n = opts.items ?? 1 + Math.floor(r() * 2);
  const items = [];
  for (let i = 0; i < n; i++) {
    const p = opts.sku ? CATALOG.find((c) => c.sku === opts.sku) : pick(CATALOG.filter((c) => c.unit_amount < 20000 || opts.allowBig), r);
    if (items.some((x) => x.sku === p.sku)) continue;
    items.push({ sku: p.sku, name: p.name, qty: opts.qty ?? 1, unit_amount: p.unit_amount });
  }
  const total = items.reduce((s, i) => s + i.qty * i.unit_amount, 0);
  return { id: "ord_" + Math.floor(r() * 1e9).toString(36), merchant_id: MERCHANT_ID, currency: "usd", total, items };
}

const sptFor = (total, now, extra = {}) => ({
  type: "stripe-spt",
  token: "spt_" + Math.floor(Math.random() * 1e12).toString(36),
  allowance: { max_amount: extra.max ?? Math.max(10000, Math.ceil(total * 1.2)), currency: "usd", merchant_id: MERCHANT_ID, expires_at: now + 3600 },
});

const viFor = (agent, user, order, now, extra = {}) =>
  buildVerifiableIntent({
    issuer: ISSUER,
    user,
    agent,
    order,
    constraints: { allowed_merchants: [MERCHANT_ID], max_amount: { amount: extra.cap ?? 30000, currency: "usd" } },
    mode: extra.mode ?? "autonomous",
    now,
    presentedTransactionId: extra.presented,
  });

/** Scenarios for the playground. Each returns a freshly signed request. */
export const SCENARIOS = [
  { id: "valid-payer", name: "Valid paying agent", expect: "allow", description: "ShopAssist buys coffee with a Verifiable Intent mandate and a Stripe shared payment token inside its limits." },
  { id: "browser", name: "Browsing agent", expect: "allow", description: "CartPilot fetches a product page with an agent-browser-auth signature. No mandate needed." },
  { id: "ap2-cart", name: "AP2 signed cart", expect: "allow", description: "The shopper approved this exact cart. The merchant signed first, then the user." },
  { id: "replay", name: "Replayed request", expect: "block", description: "A captured valid request is sent a second time. The nonce has already been used." },
  { id: "expired", name: "Expired signature", expect: "block", description: "The signature window closed an hour ago." },
  { id: "tampered", name: "Changed after signing", expect: "block", description: "Signed for /checkout but sent to /admin/refund. The signature no longer matches." },
  { id: "unknown-key", name: "Unknown agent key", expect: "block", description: "Signed by a key that is not in the Visa or Mastercard directory." },
  { id: "body-mismatch", name: "Swapped consumer object", expect: "block", description: "The consumer recognition object carries a different nonce, so it was lifted from another request." },
  { id: "no-mandate", name: "No mandate", expect: "step_up", description: "A paying agent with no proof of what the shopper allowed." },
  { id: "over-mandate", name: "Over the mandate limit", expect: "step_up", description: "The shopper capped purchases at $100; the cart is $249." },
  { id: "wrong-checkout", name: "Different checkout presented", expect: "step_up", description: "The agent's signed checkout does not match the order it is placing." },
  { id: "over-token", name: "Over the token limit", expect: "block", description: "The order is above the shared payment token's cap. Charging would break its limits." },
];

export function buildScenario(id, now = Math.floor(Date.now() / 1000), seed = Date.now()) {
  const r = rng(seed);
  const A = AGENTS;
  const user = pick(USERS, r);
  const sign = (agent, req, o = {}) => agent.sign(req, { created: now - 3, ...o });
  const checkout = (body) => checkoutRequest(ORIGIN, body, "/checkout");
  switch (id) {
    case "valid-payer":
    case "replay": {
      const order = makeOrder(r);
      return sign(A.shopassist, checkout({ order, mandate: viFor(A.shopassist, user, order, now), payment: sptFor(order.total, now) }));
    }
    case "browser":
      return sign(A.cartpilot, { method: "GET", url: ORIGIN + "/products/beans-1kg", headers: { host: new URL(ORIGIN).host } }, { tag: "agent-browser-auth" });
    case "ap2-cart": {
      const order = makeOrder(r);
      return sign(A.cartpilot, checkout({ order, mandate: buildAp2Cart({ merchant: MERCHANT_KEY, user, order }), payment: sptFor(order.total, now) }));
    }
    case "expired": {
      const order = makeOrder(r);
      return A.shopassist.sign(checkout({ order, mandate: viFor(A.shopassist, user, order, now), payment: sptFor(order.total, now) }), { created: now - 3900, expires: now - 3600 });
    }
    case "tampered": {
      const order = makeOrder(r);
      const req = sign(A.orbit, checkout({ order, mandate: viFor(A.orbit, user, order, now), payment: sptFor(order.total, now) }));
      return { ...req, url: ORIGIN + "/admin/refund" };
    }
    case "unknown-key": {
      const order = makeOrder(r);
      return sign(A.stranger, checkout({ order, payment: sptFor(order.total, now) }));
    }
    case "body-mismatch": {
      const order = makeOrder(r);
      const nonce = "n" + Math.floor(r() * 1e12).toString(36);
      const body = {
        order,
        mandate: viFor(A.shopassist, user, order, now),
        payment: sptFor(order.total, now),
        consumer_recognition: signBodyObject({ nonce: "lifted-" + nonce, kid: A.shopassist.kid, alg: "ed25519", country: "US", postal_code: "94107" }, A.shopassist.privateJwk),
      };
      return sign(A.shopassist, checkout(body), { nonce });
    }
    case "no-mandate": {
      const order = makeOrder(r);
      return sign(A.orbit, checkout({ order, payment: sptFor(order.total, now) }));
    }
    case "over-mandate": {
      const order = makeOrder(r, { sku: "grinder-c40", items: 1, allowBig: true });
      return sign(A.shopassist, checkout({ order, mandate: viFor(A.shopassist, user, order, now, { cap: 10000 }), payment: sptFor(order.total, now) }));
    }
    case "wrong-checkout": {
      const order = makeOrder(r);
      return sign(A.orbit, checkout({ order, mandate: viFor(A.orbit, user, order, now, { presented: "ord_hash_of_a_different_cart" }), payment: sptFor(order.total, now) }));
    }
    case "over-token": {
      const order = makeOrder(r, { sku: "kettle-pour", items: 1 });
      return sign(A.cartpilot, checkout({ order, mandate: buildAp2Cart({ merchant: MERCHANT_KEY, user, order }), payment: sptFor(order.total, now, { max: 5000 }) }));
    }
    default:
      throw new Error(`Unknown scenario ${id}`);
  }
}

/** Simulate a day of traffic: mostly good agents, some failures, one agent with a dispute problem. */
export async function simulateDay({ ledger, policy, replay, count = 180, seed = 20261013 }) {
  const r = rng(seed);
  const end = Math.floor(Date.now() / 1000);
  const start = end - 24 * 3600;
  const weights = [
    ["valid-payer", 42], ["browser", 50], ["ap2-cart", 16], ["no-mandate", 12], ["over-mandate", 5], ["wrong-checkout", 4],
    ["expired", 5], ["tampered", 3], ["unknown-key", 8], ["body-mismatch", 2], ["over-token", 3], ["orbit-valid", 18], ["replay-pair", 4],
  ];
  const total = weights.reduce((s, w) => s + w[1], 0);
  const times = Array.from({ length: count }, () => start + Math.floor(r() * 24 * 3600)).sort((a, b) => a - b);
  const records = [];
  for (const t of times) {
    let x = r() * total;
    let id = weights[0][0];
    for (const [k, w] of weights) if ((x -= w) <= 0) { id = k; break; }
    const v = makeVerifier({ policy, ledger, replay, now: () => t });
    let req;
    if (id === "orbit-valid") {
      const order = makeOrder(r);
      req = AGENTS.orbit.sign(checkoutRequest(ORIGIN, { order, mandate: viFor(AGENTS.orbit, pick(USERS, r), order, t), payment: sptFor(order.total, t) }), { created: t - 2 });
    } else if (id === "replay-pair") {
      req = buildScenario("valid-payer", t, Math.floor(r() * 1e9));
      const first = await v.verify(req);
      records.push(ledger.record(first, { request: req, context: JSON.parse(req.body), paymentIntent: "pi_" + Math.floor(r() * 1e12).toString(36) }));
      const v2 = makeVerifier({ policy, ledger, replay, now: () => t + 40 });
      const second = await v2.verify(req);
      records.push(ledger.record(second, { request: req, context: JSON.parse(req.body) }));
      continue;
    } else {
      req = buildScenario(id, t, Math.floor(r() * 1e9));
    }
    const res = await v.verify(req);
    const context = req.body ? JSON.parse(req.body) : undefined;
    records.push(ledger.record(res, { request: req, context, paymentIntent: res.decision === "allow" && context?.order ? "pi_" + Math.floor(r() * 1e12).toString(36) : undefined }));
  }
  return records;
}

/** Open disputes on some allowed orders: Orbit Buyer gets several, ShopAssist one. */
export function openDisputes(ledger, seed = 7) {
  const r = rng(seed);
  const allowed = ledger.verifications().filter((v) => v.decision === "allow" && v.order?.payment_intent);
  const orbit = allowed.filter((v) => v.agent?.keyid === AGENTS.orbit.kid).slice(0, 5);
  const other = allowed.filter((v) => v.agent?.keyid === AGENTS.shopassist.kid).slice(0, 1);
  const reasons = ["10.4", "4837", "13.1", "10.4", "13.3", "4853"];
  const out = [];
  [...orbit, ...other].forEach((rec, i) => {
    out.push(
      ledger.recordDispute({
        dispute_id: "dp_" + Math.floor(r() * 1e10).toString(36),
        payment_intent: rec.order.payment_intent,
        verification_record_id: rec.record_id,
        agent_keyid: rec.agent.keyid,
        status: "opened",
        reason_code: reasons[i % reasons.length],
        amount: rec.order.amount,
        currency: rec.order.currency,
      }),
    );
  });
  return out;
}

export { buildAp2Intent };
