import { test } from "node:test";
import assert from "node:assert/strict";
import { ProveTheBuy, KeyDirectory, EvidenceLedger, buildEvidencePack, sameKey } from "../dist/index.js";
import { createAgent, generateKey, checkoutRequest, buildVerifiableIntent, buildAp2Cart, buildAafPresentation } from "../dist/testing.js";

const MERCHANT = "acct_shop_123";
const ORIGIN = "https://shop.example";
const agent = createAgent("Demo Shopper", "acc-agent");
const other = createAgent("Other Agent", "acc-other");
const issuer = generateKey("issuer-k1", "acc-issuer");
const user = generateKey("user-k1", "acc-user");
const merchantKey = generateKey("merchant-k1", "acc-merchant");
const dir = generateKey("aaf-dir-k1", "acc-dir");
const rogueDir = generateKey("rogue-dir-k1", "acc-rogue");

const order = { id: "ord_1", merchant_id: MERCHANT, currency: "usd", total: 4999, items: [{ sku: "shoe-9", name: "Running shoe, size 9", qty: 1, unit_amount: 4999 }] };
const spt = { type: "stripe-spt", token: "spt_1", allowance: { max_amount: 10000, currency: "usd", merchant_id: MERCHANT, expires_at: new Date(Date.now() + 3600e3).toISOString() } };
const constraints = { allowed_merchants: [MERCHANT], max_amount: { amount: 10000, currency: "usd" } };

function verifier(opts = {}) {
  return new ProveTheBuy({
    merchantId: MERCHANT,
    keys: new KeyDirectory({ sources: [{ name: "visa", jwks: { keys: [agent.publicJwk, other.publicJwk] } }] }),
    issuers: new KeyDirectory({ sources: [{ name: "issuers", jwks: { keys: [issuer.publicJwk] } }] }),
    agentIds: new KeyDirectory({ sources: [{ name: "civics", jwks: { keys: [dir.publicJwk] } }] }),
    merchantJwk: merchantKey.publicJwk,
    ...opts,
    policy: { mode: "enforce", ...(opts.policy ?? {}) },
  });
}
const check = (r, n) => r.checks.find((c) => c.name === n);
const send = (body, who = agent) => who.sign(checkoutRequest(ORIGIN, body));

test("approval signed by the person's own key passes approval_independent", async () => {
  const mandate = buildVerifiableIntent({ issuer, user, agent, order, constraints });
  const r = await verifier().verify(send({ order, mandate, payment: spt }));
  assert.equal(r.decision, "allow");
  assert.equal(check(r, "approval_independent").status, "pass");
});

test("agent approving its own purchase is stepped up", async () => {
  const mandate = buildVerifiableIntent({ issuer, user: agent, agent, order, constraints });
  const r = await verifier().verify(send({ order, mandate, payment: spt }));
  assert.equal(check(r, "mandate_valid").status, "pass");
  assert.equal(check(r, "approval_independent").status, "fail");
  assert.equal(r.decision, "step_up");
  assert.match(r.reasons.join(" "), /approved its own purchase/);
});

test("self-approval can be set to block", async () => {
  const mandate = buildVerifiableIntent({ issuer, user: agent, agent, order, constraints });
  const r = await verifier({ policy: { approval: { on_self_approved: "block" } } }).verify(send({ order, mandate, payment: spt }));
  assert.equal(r.decision, "block");
});

test("AP2 cart signed with the agent's key counts as self-approval", async () => {
  const mandate = buildAp2Cart({ merchant: merchantKey, user: agent, order });
  const r = await verifier().verify(send({ order, mandate, payment: spt }));
  assert.equal(check(r, "approval_independent").status, "fail");
  assert.equal(r.decision, "step_up");
});

test("valid AAF agent ID is verified, bound and recorded", async () => {
  const mandate = buildVerifiableIntent({ issuer, user, agent, order, constraints });
  const agent_id = buildAafPresentation({ directory: dir, agent, id: "aaf_pairwise_1", audience: MERCHANT, assurance: "IAL2", spendingLimit: { amount: 20000, currency: "usd" } });
  const r = await verifier().verify(send({ order, mandate, payment: spt, agent_id }));
  assert.equal(r.decision, "allow");
  assert.equal(check(r, "agent_id_valid").status, "pass");
  assert.equal(check(r, "agent_id_bound").status, "pass");
  assert.equal(check(r, "agent_id_limit").status, "pass");
  assert.deepEqual(r.agent.agentId, { framework: "aaf", directory: "civics", id: "aaf_pairwise_1", assurance: "IAL2", spendingLimit: { amount: 20000, currency: "usd" }, expiresAt: r.agent.agentId.expiresAt });
});

test("AAF ID lifted from another agent is blocked", async () => {
  const agent_id = buildAafPresentation({ directory: dir, agent: other });
  const r = await verifier().verify(send({ order, payment: spt, agent_id }));
  assert.equal(check(r, "agent_id_bound").status, "fail");
  assert.equal(r.decision, "block");
});

test("AAF ID from an untrusted directory is blocked", async () => {
  const agent_id = buildAafPresentation({ directory: rogueDir, agent });
  const r = await verifier().verify(send({ order, payment: spt, agent_id }));
  assert.equal(check(r, "agent_id_valid").status, "fail");
  assert.equal(r.decision, "block");
});

test("AAF ID issued for a different merchant, expired, or revoked is blocked", async () => {
  const wrongAud = buildAafPresentation({ directory: dir, agent, audience: "acct_elsewhere" });
  assert.equal((await verifier().verify(send({ order, payment: spt, agent_id: wrongAud }))).decision, "block");
  const expired = buildAafPresentation({ directory: dir, agent, now: Math.floor(Date.now() / 1000) - 7200, expiresInSeconds: 60 });
  assert.equal((await verifier().verify(send({ order, payment: spt, agent_id: expired }))).decision, "block");
  const revoked = buildAafPresentation({ directory: dir, agent, id: "aaf_revoked" });
  const r = await verifier({ isAgentIdRevoked: (id) => id === "aaf_revoked" }).verify(send({ order, payment: spt, agent_id: revoked }));
  assert.equal(check(r, "agent_id_status").status, "fail");
  assert.equal(r.decision, "block");
});

test("order above the AAF spending limit is stepped up", async () => {
  const mandate = buildVerifiableIntent({ issuer, user, agent, order, constraints });
  const agent_id = buildAafPresentation({ directory: dir, agent, spendingLimit: { amount: 2000, currency: "usd" } });
  const r = await verifier().verify(send({ order, mandate, payment: spt, agent_id }));
  assert.equal(check(r, "agent_id_limit").status, "fail");
  assert.equal(r.decision, "step_up");
});

test("policy can require an AAF ID from paying agents", async () => {
  const mandate = buildVerifiableIntent({ issuer, user, agent, order, constraints });
  const r = await verifier({ policy: { agent_id: { require: true } } }).verify(send({ order, mandate, payment: spt }));
  assert.equal(check(r, "agent_id_present").status, "fail");
  assert.equal(r.decision, "step_up");
});

test("evidence pack includes the approval line and the AAF section", async () => {
  const mandate = buildVerifiableIntent({ issuer, user, agent, order, constraints });
  const agent_id = buildAafPresentation({ directory: dir, agent, assurance: "IAL2" });
  const v = verifier();
  const req = send({ order, mandate, payment: spt, agent_id });
  const r = await v.verify(req);
  const ledger = new EvidenceLedger(MERCHANT);
  const rec = ledger.record(r, { request: req, context: JSON.parse(req.body), paymentIntent: "pi_1" });
  const pack = await buildEvidencePack(rec, { dispute_id: "dp_1", reason_code: "fraudulent", amount: 4999, currency: "usd" }, ledger, { merchantId: MERCHANT, issuers: v["opts"].issuers, merchantJwk: merchantKey.publicJwk });
  assert.match(pack.text, /separate from the agent's: yes/);
  assert.match(pack.text, /ACCOUNTABLE AGENTS FRAMEWORK/);
  assert.match(pack.text, /IAL2/);
});

test("sameKey compares public key material", () => {
  assert.equal(sameKey(agent.publicJwk, { ...agent.publicJwk, kid: "renamed" }), true);
  assert.equal(sameKey(agent.publicJwk, other.publicJwk), false);
  assert.equal(sameKey(undefined, agent.publicJwk), false);
});

test("identification levels: none, declared, verified, credentialed", async () => {
  const v = verifier();
  const plain = await v.verify({ method: "GET", url: ORIGIN + "/", headers: { host: "shop.example", "user-agent": "Mozilla/5.0 Chrome/131.0" } });
  assert.equal(plain.identification, "none");
  const named = await v.verify({ method: "GET", url: ORIGIN + "/", headers: { host: "shop.example", "user-agent": "Mozilla/5.0 (compatible; Claude-User/1.0)" } });
  assert.equal(named.identification, "declared");
  assert.equal(named.declaredAs, "Claude");
  assert.equal(named.decision, "not_agent");
  assert.equal(check(named, "declared_name").status, "warn");
  const mandate = buildVerifiableIntent({ issuer, user, agent, order, constraints });
  assert.equal((await v.verify(send({ order, mandate, payment: spt }))).identification, "verified");
  const agent_id = buildAafPresentation({ directory: dir, agent });
  assert.equal((await v.verify(send({ order, mandate, payment: spt, agent_id }))).identification, "credentialed");
  const lifted = buildAafPresentation({ directory: dir, agent: other });
  assert.equal((await v.verify(send({ order, payment: spt, agent_id: lifted }))).identification, "verified");
});

test("a self-approved order is not marked submittable", async () => {
  const mandate = buildVerifiableIntent({ issuer, user: agent, agent, order, constraints });
  const v = verifier({ policy: { mode: "shadow" } });
  const req = send({ order, mandate, payment: spt });
  const r = await v.verify(req);
  const ledger = new EvidenceLedger(MERCHANT);
  const rec = ledger.record(r, { request: req, context: JSON.parse(req.body), paymentIntent: "pi_2" });
  const pack = await buildEvidencePack(rec, { dispute_id: "dp_2", reason_code: "10.4", amount: 4999, currency: "usd" }, ledger, { merchantId: MERCHANT, issuers: v["opts"].issuers });
  assert.equal(pack.submittable, false);
  assert.match(pack.text, /agent signed its own approval/);
});

test("an order outside the mandate is not marked submittable", async () => {
  const big = { ...order, total: 15000, items: [{ sku: "shoe-9", name: "Running shoe, size 9", qty: 3, unit_amount: 5000 }] };
  const mandate = buildVerifiableIntent({ issuer, user, agent, order: big, constraints });
  const v = verifier({ policy: { mode: "shadow" } });
  const req = send({ order: big, mandate, payment: { ...spt, allowance: { ...spt.allowance, max_amount: 20000 } } });
  const r = await v.verify(req);
  const ledger = new EvidenceLedger(MERCHANT);
  const rec = ledger.record(r, { request: req, context: JSON.parse(req.body), paymentIntent: "pi_3" });
  const pack = await buildEvidencePack(rec, { dispute_id: "dp_3", reason_code: "13.3", amount: 15000, currency: "usd" }, ledger, { merchantId: MERCHANT, issuers: v["opts"].issuers });
  assert.equal(pack.submittable, false);
});
