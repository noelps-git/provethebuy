# @provethebuy/verify

Verify AI-agent orders at your checkout: the agent's signature, the shopper's mandate, and the order's limits. Keeps tamper-evident evidence for disputes.

```bash
npm install @provethebuy/verify
```

```js
import { ProveTheBuy, KeyDirectory, KNOWN_DIRECTORIES } from "@provethebuy/verify";

const ptb = new ProveTheBuy({
  merchantId: "acct_your_shop",
  keys: new KeyDirectory({ sources: [{ name: "visa", url: KNOWN_DIRECTORIES.visa }] }),
});

const result = await ptb.verify({ method: "POST", url, headers, body });
// result.decision: "allow" | "step_up" | "block" | "not_agent"
```

With Express:

```js
import { createMiddleware } from "@provethebuy/verify/express";
const agents = createMiddleware(ptb, ledger);
app.post("/checkout", agents.capture(), agents.verify(), handler);
```

Send records to ProveTheBuy Cloud (optional, fails open):

```js
import { connectCloud, UpstashReplayStore } from "@provethebuy/verify";
const cloud = connectCloud(ledger, { apiKey: process.env.PROVETHEBUY_API_KEY });
// serverless: await cloud.flush() before the response ends

// shared replay protection without a Redis connection
const replay = new UpstashReplayStore({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
```

Supports RFC 9421 / Web Bot Auth, Visa Trusted Agent Protocol, Mastercard Verifiable Intent (preview), AP2 (preview) and Stripe shared payment token limits. No runtime dependencies; Node 18.17+.

Full documentation, the playground and examples: [github.com/provethebuy/provethebuy](https://github.com/provethebuy/provethebuy).

Apache-2.0
