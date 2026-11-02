# Quickstart

Add AI-agent order verification to a Node.js checkout in a few minutes. It starts in shadow mode, so nothing is blocked until you decide to enforce.

You need Node.js 18.17 or newer. The verifier has no runtime dependencies.

## 1. Install

```bash
npm install @provethebuy/verify
```

> The package is published with the first tagged release. Until then, install it from a clone of the repo with `npm install ./packages/verify`.

## 2. Verify a request

```js
import { ProveTheBuy, KeyDirectory, KNOWN_DIRECTORIES } from "@provethebuy/verify";

const ptb = new ProveTheBuy({
  merchantId: "acct_your_shop",                       // as it appears in mandates and payment tokens
  keys: new KeyDirectory({ sources: [{ name: "visa", url: KNOWN_DIRECTORIES.visa }] }),
  policy: { mode: "shadow" },                         // record decisions, never block
});

const result = await ptb.verify({ method: "POST", url, headers, body });
// result.decision: "allow" | "step_up" | "block" | "not_agent"
```

Pass the raw body bytes exactly as received. A signature covers the bytes, so a body that was parsed and re-serialised will not verify.

## 3. Or use the Express middleware

```js
import express from "express";
import { ProveTheBuy, KeyDirectory, KNOWN_DIRECTORIES, FileLedger } from "@provethebuy/verify";
import { createMiddleware } from "@provethebuy/verify/express";

const ptb = new ProveTheBuy({
  merchantId: "acct_your_shop",
  keys: new KeyDirectory({ sources: [{ name: "visa", url: KNOWN_DIRECTORIES.visa }] }),
  policy: { mode: "shadow" },
});

const agents = createMiddleware(ptb, new FileLedger("acct_your_shop", "evidence.jsonl"));
const app = express();

// capture() must come before any body parser, so the bytes are kept exactly as signed.
app.post("/checkout", agents.capture(), agents.verify(), (req, res) => {
  const paymentIntent = chargeTheCustomer(req);       // your existing payment code
  agents.record(req, { paymentIntent });              // write the evidence record
  res.json({ ok: true });
});
```

## 4. Read the decision

Every request gets `req.provethebuy`:

```js
{
  decision: "allow",                // allow | step_up | block | not_agent
  reasons: ["Verified agent, valid mandate, order inside its limits."],
  enforced: false,                  // true only in enforce mode
  agent:   { keyid: "shopassist-k1", protocol: "visa-tap", tag: "agent-payer-auth" },
  mandate: { type: "verifiable-intent", mode: "autonomous", valid: true },
  checks:  [ /* every check, with pass / fail / warn / skip and a plain-English detail */ ]
}
```

Requests from people (no agent signature) come back as `not_agent` and pass straight through. When you're happy with what shadow mode shows, set `mode: "enforce"`: step-ups return `409` and blocks return `403`.

## 5. Running more than one server

Nonces must be remembered across servers to stop replays. Use the Redis store, or Upstash over HTTP on serverless:

```js
import { UpstashReplayStore } from "@provethebuy/verify";

const replay = new UpstashReplayStore({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
```

## 6. Send records to ProveTheBuy Cloud (optional)

Cloud keeps records for up to 25 months and handles agent-order disputes on Stripe. The connection runs in the background and fails open.

```js
import { connectCloud } from "@provethebuy/verify";

const cloud = connectCloud(ledger, { apiKey: process.env.PROVETHEBUY_API_KEY });
// serverless: await cloud.flush() before the response ends
```

Get an API key at [app.provethebuy.com](https://app.provethebuy.com).

## Next

- [Policy](policy.md): every option, with examples
- [Protocols](protocols.md): exactly what is checked for each standard
- [CLI](cli.md): count agent traffic in your logs
- A runnable Express shop and an agent that buys from it: [`examples/express-checkout`](https://github.com/noelps-git/provethebuy/tree/main/examples/express-checkout)
