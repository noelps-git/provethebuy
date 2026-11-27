# Changelog

All notable changes are listed here. The project follows [Semantic Versioning](https://semver.org).

## Unreleased

- `@provethebuy/verify`: `approval_independent` check flags an agent that signed its own approval (step-up by default, `approval.on_self_approved`). Evidence packs for self-approved or out-of-mandate orders are no longer marked submittable.
- `@provethebuy/verify`: Accountable Agents Framework agent IDs (preview): directory signature, key binding to the request signer, audience, expiry, revocation and spending limit, recorded in the evidence record and pack. New `agentIds` and `isAgentIdRevoked` options and `agent_id` policy.
- `@provethebuy/verify`: every result and record carries an identification level (`none`, `declared`, `verified`, `credentialed`) and the agent name found in the User-Agent, if any.
- Hosted playground at provethebuy.com/playground: pick a store and agent, see what the merchant gets, 13 one-click attacks, a 40-days-later dispute view, copy as code, shareable scenario links, and bring-your-own-agent (paste a signed request or point an agent at a sandbox URL).

## 0.1.0 (unreleased)

First preview.

- `@provethebuy/verify`: RFC 9421 / Web Bot Auth verification, Visa TAP body objects, Mastercard Verifiable Intent, AP2 cart and intent mandates, Stripe shared payment token limits, policy engine with shadow and enforce modes, replay stores (memory, Redis), hash-chained evidence ledger, evidence packs with re-verification, Express middleware, testing helpers.
- `@provethebuy/cli`: `traffic-check`, `init`, `keys new`, `sign`, `verify`, `ledger verify`.
- Local playground (`npm run demo`) with six screens.
- 14 cross-language test vectors.
