// A minimal checkout protected by ProveTheBuy.
// Run from the repo root: npm run example   then, in a second terminal: npm run agent
import express from "express";
import { mkdirSync } from "node:fs";
import { ProveTheBuy, KeyDirectory, FileLedger } from "@provethebuy/verify";
import { createMiddleware } from "@provethebuy/verify/express";
import { createAgent, generateKey } from "@provethebuy/verify/testing";

const MERCHANT_ID = "acct_example_shop";
const PORT = Number(process.env.PORT ?? 4320);

// In production, point at the networks' key directories instead:
//   keys: new KeyDirectory({ sources: [{ name: "visa", url: KNOWN_DIRECTORIES.visa }] })
// Here we trust the demo agent and card issuer that agent.mjs plays (same fixed seeds).
const demoKeys = { keys: [createAgent("Example Agent", "example-agent").publicJwk] };
const demoIssuers = { keys: [generateKey("example-issuer-k1", "example-issuer").publicJwk] };
mkdirSync(".demo", { recursive: true });

const ptb = new ProveTheBuy({
  merchantId: MERCHANT_ID,
  keys: new KeyDirectory({ sources: [{ name: "demo", jwks: demoKeys }] }),
  issuers: new KeyDirectory({ sources: [{ name: "issuers", jwks: demoIssuers }] }),
  policy: { mode: process.env.PTB_MODE === "enforce" ? "enforce" : "shadow" },
});
const ledger = new FileLedger(MERCHANT_ID, ".demo/evidence.jsonl");
const agentCheck = createMiddleware(ptb, ledger);

const app = express();

app.post("/checkout", agentCheck.capture(), agentCheck.verify(), (req, res) => {
  const v = req.provethebuy;
  // ... charge the card or shared payment token here ...
  const paymentIntent = "pi_demo_" + Date.now();
  const rec = agentCheck.record(req, { paymentIntent });
  res.json({ ok: true, payment_intent: paymentIntent, agent_decision: v.decision, enforced: v.enforced, reasons: v.reasons, evidence_record: rec?.record_id });
});

app.listen(PORT, () => {
  console.log(`Checkout listening on http://localhost:${PORT}  (mode: ${ptb.policy.mode})`);
  console.log("In a second terminal, run: npm run agent");
});
