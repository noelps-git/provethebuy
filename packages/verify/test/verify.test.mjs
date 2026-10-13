import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify as nodeVerify } from "node:crypto";
import {
  ProveTheBuy,
  KeyDirectory,
  EvidenceLedger,
  buildEvidencePack,
  parseSignatureInput,
  parseSignatureHeader,
  signatureBase,
  canonicalize,
  orderHash,
} from "../dist/index.js";
import { createAgent, generateKey, checkoutRequest, buildVerifiableIntent, buildAp2Cart, buildAp2Intent, signBodyObject } from "../dist/testing.js";

const MERCHANT = "acct_shop_123";
const ORIGIN = "https://shop.example";

const agent = createAgent("Demo Shopper", "agent-seed");
const issuer = generateKey("issuer-k1", "issuer-seed");
const user = generateKey("user-k1", "user-seed");
const merchantKey = generateKey("merchant-k1", "merchant-seed");

const order = {
  id: "ord_1001",
  merchant_id: MERCHANT,
  currency: "usd",
  total: 4999,
  items: [{ sku: "beans-1kg", name: "Coffee beans 1 kg", qty: 1, unit_amount: 4999 }],
};
const spt = { type: "stripe-spt", token: "spt_test_1", allowance: { max_amount: 10000, currency: "usd", merchant_id: MERCHANT, expires_at: new Date(Date.now() + 3600e3).toISOString() } };
const constraints = { allowed_merchants: [MERCHANT], max_amount: { amount: 10000, currency: "usd" } };

function verifier(policy = {}) {
  return new ProveTheBuy({
    merchantId: MERCHANT,
    keys: new KeyDirectory({ sources: [{ name: "visa", jwks: { keys: [agent.publicJwk] } }] }),
    issuers: new KeyDirectory({ sources: [{ name: "issuers", jwks: { keys: [issuer.publicJwk] } }] }),
    merchantJwk: merchantKey.publicJwk,
    policy: { mode: "enforce", ...policy },
  });
}

function signedCheckout(body, signOpts = {}) {
  return agent.sign(checkoutRequest(ORIGIN, body), signOpts);
}

const viMandate = (o = order, extra = {}) => buildVerifiableIntent({ issuer, user, agent, order: o, constraints, mode: "autonomous", ...extra });

const decision = (r) => r.decision;
const check = (r, name) => r.checks.find((c) => c.name === name);

test("RFC 9421 Appendix B.2.6 Ed25519 test vector verifies", () => {
  const key = createPublicKey("-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAJrQLj5P/89iXES9+vFgrIy29clF9CC/oPPsw3c5D0bs=\n-----END PUBLIC KEY-----\n");
  const req = {
    method: "POST",
    url: "https://example.com/foo?param=Value&Pet=dog",
    headers: { host: "example.com", date: "Tue, 20 Apr 2021 02:07:55 GMT", "content-type": "application/json", "content-length": "18" },
    body: '{"hello": "world"}',
  };
  const [p] = parseSignatureInput('sig-b26=("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"');
  const sig = parseSignatureHeader("sig-b26=:wqcAqbmYJ2ji2glfAMaRy4gruYYnx2nEFN2HN6jrnDnQCK1u02Gb04v9EDgwUPiu4A0w6vuQv5lIp5WPpBKRCw==:")["sig-b26"];
  assert.equal(nodeVerify(null, Buffer.from(signatureBase(req, p)), key, sig), true);
});

test("valid paying agent with Verifiable Intent mandate and SPT is allowed", async () => {
  const r = await verifier().verify(signedCheckout({ order, mandate: viMandate(), payment: spt }));
  assert.equal(decision(r), "allow", JSON.stringify(r.reasons));
  assert.equal(r.agent.protocol, "visa-tap");
  assert.equal(r.orderHash, orderHash(order));
  for (const n of ["signature_valid", "nonce_unused", "window", "key_found", "mandate_valid", "order_within_mandate", "token_limits"]) assert.equal(check(r, n).status, "pass", n);
});

test("requests without signature headers are left alone", async () => {
  const r = await verifier().verify(checkoutRequest(ORIGIN, { order }));
  assert.equal(decision(r), "not_agent");
});

test("browsing agent is allowed without a mandate", async () => {
  const req = agent.sign({ method: "GET", url: ORIGIN + "/products/beans", headers: { host: "shop.example" } }, { tag: "agent-browser-auth" });
  const r = await verifier().verify(req);
  assert.equal(decision(r), "allow");
});

test("replayed request is blocked", async () => {
  const v = verifier();
  const req = signedCheckout({ order, mandate: viMandate(), payment: spt });
  assert.equal(decision(await v.verify(req)), "allow");
  const again = await v.verify(req);
  assert.equal(decision(again), "block");
  assert.equal(check(again, "nonce_unused").status, "fail");
});

test("expired signature is blocked", async () => {
  const past = Math.floor(Date.now() / 1000) - 3600;
  const r = await verifier().verify(signedCheckout({ order }, { created: past, expires: past + 300 }));
  assert.equal(decision(r), "block");
  assert.equal(check(r, "window").status, "fail");
});

test("window longer than 8 minutes is blocked", async () => {
  const now = Math.floor(Date.now() / 1000);
  const r = await verifier().verify(signedCheckout({ order }, { created: now, expires: now + 3600 }));
  assert.equal(check(r, "window").status, "fail");
});

test("tampered path is blocked", async () => {
  const req = signedCheckout({ order, mandate: viMandate(), payment: spt });
  const r = await verifier().verify({ ...req, url: ORIGIN + "/admin/refund" });
  assert.equal(decision(r), "block");
  assert.equal(check(r, "signature_valid").status, "fail");
});

test("unknown agent key is blocked", async () => {
  const stranger = createAgent("Stranger", "stranger-seed");
  const r = await verifier().verify(stranger.sign(checkoutRequest(ORIGIN, { order })));
  assert.equal(decision(r), "block");
  assert.equal(check(r, "key_found").status, "fail");
});

test("paying agent without a mandate triggers step-up", async () => {
  const r = await verifier().verify(signedCheckout({ order, payment: spt }));
  assert.equal(decision(r), "step_up");
  assert.equal(r.stepUp.suggested, "ap2-cart-mandate");
});

test("order above the mandate cap triggers step-up", async () => {
  const big = { ...order, total: 15000, items: [{ sku: "beans-1kg", qty: 3, unit_amount: 5000 }] };
  const r = await verifier().verify(signedCheckout({ order: big, mandate: viMandate(big), payment: { ...spt, allowance: { ...spt.allowance, max_amount: 20000 } } }));
  assert.equal(decision(r), "step_up");
  assert.equal(check(r, "order_within_mandate").status, "fail");
});

test("agent presenting a different checkout than the order fails the mandate match", async () => {
  const r = await verifier().verify(signedCheckout({ order, mandate: viMandate(order, { presentedTransactionId: "something-else" }), payment: spt }));
  assert.equal(check(r, "order_within_mandate").status, "fail");
});

test("tampered mandate is blocked", async () => {
  const m = viMandate();
  const r = await verifier().verify(signedCheckout({ order, mandate: { ...m, l3: m.l3.slice(0, -4) + "AAAA" }, payment: spt }));
  assert.equal(decision(r), "block");
});

test("charging above the shared payment token cap is blocked", async () => {
  const r = await verifier().verify(signedCheckout({ order, mandate: viMandate(), payment: { ...spt, allowance: { ...spt.allowance, max_amount: 1000 } } }));
  assert.equal(decision(r), "block");
  assert.equal(check(r, "token_limits").status, "fail");
});

test("AP2 cart mandate signed by merchant and user is allowed; a different cart is not", async () => {
  const good = await verifier().verify(signedCheckout({ order, mandate: buildAp2Cart({ merchant: merchantKey, user, order }), payment: spt }));
  assert.equal(decision(good), "allow", JSON.stringify(good.reasons));
  assert.equal(check(good, "mandate_user_key_trust").status, "warn");
  const other = { ...order, total: 2999, items: [{ sku: "beans-500g", qty: 1, unit_amount: 2999 }] };
  const bad = await verifier().verify(signedCheckout({ order, mandate: buildAp2Cart({ merchant: merchantKey, user, order: other }), payment: spt }));
  assert.equal(check(bad, "order_within_mandate").status, "fail");
});

test("AP2 intent above the confirmation threshold triggers step-up", async () => {
  const big = { ...order, total: 60000, items: [{ sku: "grinder", qty: 1, unit_amount: 60000 }] };
  const r = await verifier().verify(
    signedCheckout({ order: big, mandate: buildAp2Intent({ user, maxAmount: 100000, currency: "usd" }), payment: { ...spt, allowance: { ...spt.allowance, max_amount: 100000 } } }),
  );
  assert.equal(decision(r), "step_up");
  assert.equal(check(r, "intent_threshold").status, "warn");
});

test("body object with the wrong nonce is blocked", async () => {
  const req = checkoutRequest(ORIGIN, {
    order,
    mandate: viMandate(),
    payment: spt,
    consumer_recognition: signBodyObject({ nonce: "not-the-header-nonce", kid: agent.kid, alg: "ed25519", country: "US" }, agent.privateJwk),
  });
  const r = await verifier().verify(agent.sign(req, { nonce: "header-nonce-123" }));
  assert.equal(decision(r), "block");
  assert.equal(check(r, "body_consumer_recognition").status, "fail");
});

test("body object bound to the header nonce passes", async () => {
  const nonce = "header-nonce-456";
  const req = checkoutRequest(ORIGIN, {
    order,
    mandate: viMandate(),
    payment: spt,
    consumer_recognition: signBodyObject({ nonce, kid: agent.kid, alg: "ed25519", country: "US", postal_code: "94107" }, agent.privateJwk),
  });
  const r = await verifier().verify(agent.sign(req, { nonce }));
  assert.equal(check(r, "body_consumer_recognition").status, "pass");
  assert.equal(decision(r), "allow");
});

test("shadow mode records the decision but does not enforce it", async () => {
  const r = await verifier({ mode: "shadow" }).verify(signedCheckout({ order }));
  assert.equal(r.enforced, false);
  assert.equal(decision(r), "step_up");
});

test("errors fail open by default and closed when configured", async () => {
  const boom = () => { throw new Error("reputation service down"); };
  const open = new ProveTheBuy({ merchantId: MERCHANT, keys: new KeyDirectory({ sources: [{ name: "visa", jwks: { keys: [agent.publicJwk] } }] }), reputation: boom });
  assert.equal(decision(await open.verify(signedCheckout({ order }))), "not_agent");
  const closed = new ProveTheBuy({ merchantId: MERCHANT, keys: new KeyDirectory({ sources: [{ name: "visa", jwks: { keys: [agent.publicJwk] } }] }), reputation: boom, policy: { fail: "closed" } });
  assert.equal(decision(await closed.verify(signedCheckout({ order }))), "block");
});

test("ledger chain detects tampering", async () => {
  const v = verifier();
  const ledger = new EvidenceLedger(MERCHANT);
  for (let i = 0; i < 3; i++) {
    const req = signedCheckout({ order, mandate: viMandate(), payment: spt });
    const res = await v.verify(req);
    ledger.record(res, { request: req, context: JSON.parse(req.body), paymentIntent: `pi_${i}` });
  }
  assert.deepEqual(ledger.verifyChain().ok, true);
  ledger.records[1].decision = "block";
  const after = ledger.verifyChain();
  assert.equal(after.ok, false);
  assert.equal(after.brokenAt, ledger.records[1].record_id);
});

test("evidence pack re-verifies with the key snapshot after the key leaves the directory", async () => {
  const v = verifier();
  const ledger = new EvidenceLedger(MERCHANT);
  const req = signedCheckout({ order, mandate: viMandate(), payment: spt });
  const res = await v.verify(req);
  const rec = ledger.record(res, { request: req, context: JSON.parse(req.body), paymentIntent: "pi_42" });
  const pack = await buildEvidencePack(rec, { dispute_id: "dp_1", reason_code: "10.4", amount: 4999, currency: "usd" }, ledger, {
    merchantId: MERCHANT,
    issuers: new KeyDirectory({ sources: [{ name: "issuers", jwks: { keys: [issuer.publicJwk] } }] }),
    policy: { mode: "enforce" },
  });
  assert.equal(pack.reverification.ok, true, pack.reverification.detail);
  assert.equal(pack.submittable, true);
  assert.match(pack.text, /Cardholder authorisation/i);
});

test("canonical JSON sorts keys and order hash ignores key order", () => {
  assert.equal(canonicalize({ b: 1, a: [true, null, "x"] }), '{"a":[true,null,"x"],"b":1}');
  const reordered = { items: order.items, total: order.total, currency: "USD", merchant_id: MERCHANT };
  assert.equal(orderHash(reordered), orderHash(order));
});
