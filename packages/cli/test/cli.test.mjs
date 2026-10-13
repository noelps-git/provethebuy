import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyse, parseLine } from "../dist/traffic.js";

const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const sample = new URL("../samples/access.log", import.meta.url).pathname;

test("parses combined and JSON log lines", () => {
  const c = parseLine('1.2.3.4 - - [13/Oct/2026:10:00:00 +0000] "GET /checkout HTTP/1.1" 200 12 "-" "compatible; ChatGPT-User/1.0"');
  assert.equal(c.path, "/checkout");
  const j = parseLine(JSON.stringify({ path: "/api/checkout", headers: { "signature-input": 'sig1=("@authority");tag="agent-payer-auth"', signature: "sig1=:AA:" } }));
  assert.equal(j.signed, true);
  assert.equal(j.tag, "agent-payer-auth");
});

test("traffic check counts agents and checkout hits in the sample log", () => {
  const r = analyse(readFileSync(sample, "utf8").split("\n"));
  assert.ok(r.agentRequests > 100);
  assert.ok(r.checkoutHits > 0);
  assert.equal(r.signedRequests, 14);
});

test("keys, sign and verify round-trip through the CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "ptb-"));
  const key = join(dir, "agent-key.json");
  execFileSync("node", [cli, "keys", "new", "Test Agent", "--out", key]);
  const order = { merchant_id: "acct_1", currency: "usd", total: 500, items: [{ sku: "a", qty: 1, unit_amount: 500 }] };
  const req = { method: "GET", url: "https://shop.example/products/a", headers: { host: "shop.example" } };
  writeFileSync(join(dir, "req.json"), JSON.stringify(req));
  const signed = execFileSync("node", [cli, "sign", join(dir, "req.json"), "--key", key, "--tag", "agent-browser-auth"]).toString();
  writeFileSync(join(dir, "signed.json"), signed);
  const out = execFileSync("node", [cli, "verify", join(dir, "signed.json"), "--jwks", join(dir, "agent-key.jwks.json"), "--merchant", "acct_1", "--json"]).toString();
  assert.equal(JSON.parse(out).decision, "allow");
  void order;
});
