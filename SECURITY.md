# Security policy

ProveTheBuy sits in front of checkouts, so security reports get priority.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private vulnerability reporting ("Report a vulnerability" under the Security tab of this repository), or email **security@provethebuy.dev**.

Include what you found, how to reproduce it, and the impact you expect. You'll get an acknowledgement within 2 working days and a plan within 7.

## In scope

- Signature verification bypasses (accepting a forged, edited, expired or replayed request)
- Mandate or order-binding bypasses (an order outside the shopper's limits being allowed)
- Ledger tampering that `ledger verify` doesn't detect
- Anything that makes the middleware block or crash checkout unexpectedly

## Supported versions

Only the latest release receives fixes while the project is in preview (0.x).
