# Security

## What ProveTheBuy protects against

| Threat | Handled by |
| --- | --- |
| A bot pretends to be a known agent | Signature checked against the network's key directory; unknown keys are blocked. |
| A real signed request is captured and sent again | Nonce stored until expiry; second use blocked. Checked after the signature, so forged requests can't burn real nonces. |
| A signed request is edited (path, host, body) | Covered components are part of the signature base; any change fails `signature_valid`. |
| An old signature is reused much later | `created` / `expires` window, at most 8 minutes, with bounded clock skew. |
| A real agent buys more than the shopper allowed | Mandate constraints and payment token limits checked against the exact order. |
| A mandate from one purchase is reused for another | Verifiable Intent L3 must carry this order's hash; AP2 carts are signed by you and the user. |
| Body objects are swapped between requests | Consumer and payment objects must carry the header signature's nonce and key id. |
| An agent with a bad record keeps ordering | Per-key dispute rate from your own ledger triggers step-up. |
| Evidence is edited after the fact | Hash-chained ledger; any edit or deletion breaks the chain. A Merkle root can be anchored externally. |
| The agent rotates its key before a dispute | Each record keeps a snapshot of the public key used; re-verification uses the snapshot. |

## What it deliberately does not do

- **No card data.** It never decrypts payment containers or sees card numbers, so it adds nothing to your PCI scope.
- **No on-device or browser fingerprinting.** It works only from what the agent signs.
- **No outbound calls at order time** except fetching key directories, which are cached.

## Operating it safely

- **Fail open by default.** A bug in the verifier never stops a sale unless you choose `fail: closed`.
- **Shadow mode first.** Run it for a week and read the decisions before enforcing.
- **Use Redis for replay protection** when you run more than one server; in-memory nonces only protect one process.
- **Keep `capture()` before any body parser.** Signatures cover exact bytes; a re-serialised body won't verify.
- **Set `publicOrigin`** behind a proxy or CDN, so `@authority` matches what the agent signed.
- **Retention.** Keep records at least as long as your dispute window (card networks allow up to 120 days, often more with pre-arbitration). The cloud plan defaults to 13 months. Personal data can be deleted while the hashes stay, so the chain stays valid.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
