// Plays a shopping agent: signs a checkout request with a Verifiable Intent mandate and sends it.
import { createAgent, generateKey, checkoutRequest, buildVerifiableIntent } from "@provethebuy/verify/testing";

const agent = createAgent("Example Agent", "example-agent");
const issuer = generateKey("example-issuer-k1", "example-issuer");
const user = generateKey("example-user-k1", "example-user");

const PORT = Number(process.env.PORT ?? 4320);
const order = { id: "ord_" + Date.now(), merchant_id: "acct_example_shop", currency: "usd", total: 4999, items: [{ sku: "beans-1kg", qty: 1, unit_amount: 4999 }] };
const mandate = buildVerifiableIntent({ issuer, user, agent, order, constraints: { allowed_merchants: ["acct_example_shop"], max_amount: { amount: 10000, currency: "usd" } } });
const payment = { type: "stripe-spt", token: "spt_demo", allowance: { max_amount: 10000, currency: "usd", merchant_id: "acct_example_shop", expires_at: new Date(Date.now() + 3600e3).toISOString() } };

const req = agent.sign(checkoutRequest(`http://localhost:${PORT}`, { order, mandate, payment }));
let res;
try {
  res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
} catch {
  console.error(`Couldn't reach the shop on port ${PORT}. Start it first with: npm run example`);
  process.exit(1);
}
console.log(res.status, JSON.stringify(await res.json(), null, 2));
