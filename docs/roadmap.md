# Roadmap

## Now (0.1, preview)

- TypeScript verifier: RFC 9421, Web Bot Auth, Visa TAP, Verifiable Intent, AP2, Stripe token limits
- Hash-chained evidence ledger and evidence packs
- Express middleware, CLI, local playground, test vectors

## Next

- Publish `@provethebuy/verify` and `@provethebuy/cli` to npm with signed provenance
- Next.js and edge-runtime middleware (WebCrypto only)
- Python and Go verifiers passing the same test vectors
- Postgres and SQLite ledgers
- A GitHub Action for agent builders: "does my agent sign correctly?"

## Cloud

- Hosted ledger with 13-month retention and external anchoring
- Dashboard: the [five screens](cloud-screens.md)
- Stripe App: dispute webhooks, automatic evidence submission
- Billing and plans

## When the standards settle

- Visa TAP body-object signing, once [issue #23](https://github.com/visa/trusted-agent-protocol/issues/23) is answered
- AP2 user-key trust
- Verifiable Intent field names once Mastercard finalises them
