// Generates conformance vectors in test-vectors/. Run: npm run vectors
// Keys are derived from fixed seeds, so key ids and public keys are stable across runs.
import { writeFileSync, mkdirSync } from "node:fs";
import { createAgent, generateKey, checkoutRequest, buildVerifiableIntent, buildAp2Cart, signBodyObject } from "@provethebuy/verify/testing";

const OUT = new URL("../test-vectors/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const MERCHANT = "acct_vectors_merchant";
const ORIGIN = "https://shop.example";
const NOW = Math.floor(Date.now() / 1000);

const agent = createAgent("Vector Agent", "vector-agent");
const stranger = createAgent("Unknown Agent", "vector-stranger");
const issuer = generateKey("vector-issuer-k1", "vector-issuer");
const user = generateKey("vector-user-k1", "vector-user");
const merchant = generateKey("vector-merchant-k1", "vector-merchant");

const order = { id: "ord_v1", merchant_id: MERCHANT, currency: "usd", total: 4999, items: [{ sku: "beans-1kg", qty: 1, unit_amount: 4999 }] };
const big = { id: "ord_v2", merchant_id: MERCHANT, currency: "usd", total: 15000, items: [{ sku: "beans-1kg", qty: 3, unit_amount: 5000 }] };
const constraints = { allowed_merchants: [MERCHANT], max_amount: { amount: 10000, currency: "usd" } };
const spt = (max = 10000) => ({ type: "stripe-spt", token: "spt_vector", allowance: { max_amount: max, currency: "usd", merchant_id: MERCHANT, expires_at: NOW + 3600 } });
const vi = (o, extra = {}) => buildVerifiableIntent({ issuer, user, agent, order: o, constraints, mode: "autonomous", now: NOW, seed: "vectors", ...extra });
const sign = (req, o = {}) => agent.sign(req, { created: NOW - 5, nonce: o.nonce ?? "vector-nonce-" + Math.random().toString(36).slice(2, 10), ...o });

const vectors = [];
const add = (name, description, request, expect, extra = {}) => vectors.push({ name, description, request, expect, ...extra });

add("tap-payer-valid", "Paying agent with a Verifiable Intent mandate and a shared payment token inside its limits.", sign(checkoutRequest(ORIGIN, { order, mandate: vi(order), payment: spt() })), { decision: "allow" });
add("tap-browser-valid", "Browsing agent fetching a product page.", sign({ method: "GET", url: ORIGIN + "/products/beans-1kg", headers: { host: "shop.example" } }, { tag: "agent-browser-auth" }), { decision: "allow" });
add("tap-expired", "Signature window ended an hour ago.", agent.sign(checkoutRequest(ORIGIN, { order }), { created: NOW - 3900, expires: NOW - 3600, nonce: "vector-expired" }), { decision: "block", failed: "window" });
add("tap-window-too-long", "expires - created is 1 hour, above the 8-minute limit.", agent.sign(checkoutRequest(ORIGIN, { order }), { created: NOW - 5, expires: NOW + 3595, nonce: "vector-long" }), { decision: "block", failed: "window" });
const tampered = sign(checkoutRequest(ORIGIN, { order, mandate: vi(order), payment: spt() }), { nonce: "vector-tampered" });
add("tap-tampered-path", "Signed for /checkout, replayed against /admin/refund.", { ...tampered, url: ORIGIN + "/admin/refund" }, { decision: "block", failed: "signature_valid" });
add("tap-unknown-key", "Signed by a key that is not in the directory.", stranger.sign(checkoutRequest(ORIGIN, { order }), { created: NOW - 5, nonce: "vector-stranger" }), { decision: "block", failed: "key_found" });
const replay = sign(checkoutRequest(ORIGIN, { order, mandate: vi(order), payment: spt() }), { nonce: "vector-replay" });
add("tap-replay", "The same signed request sent twice. The second must be blocked.", replay, { decision: "allow", second: { decision: "block", failed: "nonce_unused" } }, { sendTwice: true });
const nonce = "vector-body-nonce";
add("tap-body-object-bound", "Consumer recognition object signed with the agent key and carrying the header nonce.", sign(checkoutRequest(ORIGIN, { order, mandate: vi(order), payment: spt(), consumer_recognition: signBodyObject({ nonce, kid: agent.kid, alg: "ed25519", country: "US" }, agent.privateJwk) }), { nonce }), { decision: "allow" });
add("tap-body-object-wrong-nonce", "Consumer recognition object carries a different nonce than the header.", sign(checkoutRequest(ORIGIN, { order, mandate: vi(order), payment: spt(), consumer_recognition: signBodyObject({ nonce: "other", kid: agent.kid, alg: "ed25519" }, agent.privateJwk) }), { nonce: "vector-body-bad" }), { decision: "block", failed: "body_consumer_recognition" });
add("vi-no-mandate", "Paying agent with no mandate.", sign(checkoutRequest(ORIGIN, { order, payment: spt() })), { decision: "step_up", failed: "mandate_present" });
add("vi-over-cap", "Order total above the mandate's max amount.", sign(checkoutRequest(ORIGIN, { order: big, mandate: vi(big), payment: spt(20000) })), { decision: "step_up", failed: "order_within_mandate" });
add("vi-wrong-checkout", "Agent presents a different checkout (transaction_id) than the order.", sign(checkoutRequest(ORIGIN, { order, mandate: vi(order, { presentedTransactionId: "not-this-order" }), payment: spt() })), { decision: "step_up", failed: "order_within_mandate" });
add("spt-over-limit", "Order total above the shared payment token cap.", sign(checkoutRequest(ORIGIN, { order, mandate: vi(order), payment: spt(1000) })), { decision: "block", failed: "token_limits" });
add("ap2-cart-valid", "AP2 cart mandate signed by merchant and user, matching the order.", sign(checkoutRequest(ORIGIN, { order, mandate: buildAp2Cart({ merchant, user, order }), payment: spt() })), { decision: "allow" });

const bundle = {
  version: 1,
  generated_at: new Date(NOW * 1000).toISOString(),
  now: NOW,
  merchant_id: MERCHANT,
  note: "Verify each request at time `now` with the directories below. Body-object signatures use RFC 8785 canonical JSON pending Visa issue #23.",
  directories: { agents: { keys: [agent.publicJwk] }, issuers: { keys: [issuer.publicJwk] } },
  merchant_jwk: merchant.publicJwk,
  vectors,
};
writeFileSync(new URL("vectors.json", OUT), JSON.stringify(bundle, null, 2));
console.log(`Wrote ${vectors.length} vectors to test-vectors/vectors.json`);
