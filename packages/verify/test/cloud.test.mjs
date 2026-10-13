import { test } from "node:test";
import assert from "node:assert/strict";
import { EvidenceLedger, connectCloud, UpstashReplayStore } from "../dist/index.js";

const fakeResult = () => ({ decision: "allow", reasons: [], checks: [], enforced: false, policyVersion: "v1", receivedAt: new Date().toISOString() });
const req = { method: "POST", url: "https://shop.example/checkout", headers: {}, body: "{}" };

test("connectCloud batches records and sends them with the API key", async () => {
  const calls = [];
  const ledger = new EvidenceLedger("acct_x");
  const cloud = connectCloud(ledger, {
    apiKey: "ptb_test_123",
    endpoint: "https://cloud.test/",
    flushIntervalMs: 60_000,
    fetch: async (url, init) => {
      calls.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
      return new Response("{}", { status: 202 });
    },
  });
  ledger.record(fakeResult(), { request: req });
  ledger.record(fakeResult(), { request: req });
  await cloud.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://cloud.test/v1/records");
  assert.equal(calls[0].auth, "Bearer ptb_test_123");
  assert.equal(calls[0].body.records.length, 2);
  assert.equal(cloud.stats.sent, 2);
  await cloud.close();
});

test("connectCloud fails open: network errors never throw and records are retried", async () => {
  let up = false;
  let sent = 0;
  const ledger = new EvidenceLedger("acct_x");
  const cloud = connectCloud(ledger, {
    apiKey: "k",
    flushIntervalMs: 60_000,
    fetch: async (_u, init) => {
      if (!up) throw new TypeError("fetch failed");
      sent += JSON.parse(init.body).records.length;
      return new Response("{}", { status: 202 });
    },
    onError: () => {},
  });
  const rec = ledger.record(fakeResult(), { request: req });
  assert.ok(rec.record_id, "recording still works while the cloud is down");
  await cloud.flush();
  assert.equal(cloud.stats.queued, 1);
  assert.equal(cloud.stats.failures, 1);
  up = true;
  await cloud.flush();
  assert.equal(sent, 1);
  assert.equal(cloud.stats.queued, 0);
  await cloud.close();
});

test("connectCloud drops the oldest records when the queue is full", async () => {
  const ledger = new EvidenceLedger("acct_x");
  const cloud = connectCloud(ledger, { apiKey: "k", maxQueue: 3, batchSize: 100, flushIntervalMs: 60_000, fetch: async () => { throw new TypeError("down"); }, onError: () => {} });
  for (let i = 0; i < 5; i++) ledger.record(fakeResult(), { request: req });
  assert.equal(cloud.stats.queued, 3);
  assert.equal(cloud.stats.dropped, 2);
  await cloud.close();
});

test("connectCloud can strip raw requests before sending", async () => {
  let body;
  const ledger = new EvidenceLedger("acct_x");
  const cloud = connectCloud(ledger, { apiKey: "k", includeArtifacts: false, flushIntervalMs: 60_000, fetch: async (_u, init) => { body = JSON.parse(init.body); return new Response("{}", { status: 202 }); } });
  ledger.record(fakeResult(), { request: req });
  await cloud.flush();
  assert.equal(body.records[0].artifacts, undefined);
  await cloud.close();
});

test("UpstashReplayStore sends SET NX EX and reads the result", async () => {
  const seen = new Set();
  const store = new UpstashReplayStore({
    url: "https://up.test",
    token: "t",
    fetch: async (_u, init) => {
      const [, key, , nx, ex, ttl] = JSON.parse(init.body);
      assert.equal(nx, "NX");
      assert.equal(ex, "EX");
      assert.equal(ttl, "300");
      const result = seen.has(key) ? null : (seen.add(key), "OK");
      return new Response(JSON.stringify({ result }), { status: 200 });
    },
  });
  assert.equal(await store.checkAndRemember("kid:n1", 300), true);
  assert.equal(await store.checkAndRemember("kid:n1", 300), false);
});

test("verifyConfirmation checks the signature, type and order hash", async () => {
  const { generateKeyPairSync, sign } = await import("node:crypto");
  const { verifyConfirmation } = await import("../dist/index.js");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "ptb-1" }] };
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b({ alg: "EdDSA", kid: "ptb-1" });
  const body = b({ typ: "provethebuy-confirmation", sub: "cf_1", status: "approved", order_hash: "abc", store: "st", decided_at: "x", iat: Math.floor(Date.now() / 1000), iss: "t" });
  const token = `${head}.${body}.${sign(null, Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`;
  assert.equal((await verifyConfirmation(token, { jwks, orderHash: "abc" })).status, "approved");
  await assert.rejects(() => verifyConfirmation(token, { jwks, orderHash: "other" }), /different order/);
  await assert.rejects(() => verifyConfirmation(token.slice(0, -4) + "AAAA", { jwks }), /does not verify/);
});
