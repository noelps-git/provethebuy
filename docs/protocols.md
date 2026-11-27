# Protocols

Agent-commerce standards are young and some details are still unpublished. This page says exactly what ProveTheBuy checks for each one, and marks every place where it follows an assumption rather than a published rule.

## RFC 9421

HTTP Message Signatures are the base layer for Web Bot Auth, Visa TAP and Mastercard Agent Pay.

- Parses `Signature-Input` and `Signature` (structured fields), builds the signature base from the covered components (`@authority`, `@path`, `@method`, `@target-uri`, `content-digest` and any header).
- Algorithms: `ed25519`, `rsa-pss-sha512`, `ecdsa-p256-sha256`, and `ps256`. When `alg` is missing it is inferred from the key.
- Passes the RFC's own Ed25519 test vector, [Appendix B.2.6](https://www.rfc-editor.org/rfc/rfc9421#appendix-B.2.6). The test is in `packages/verify/test/verify.test.mjs`.

## Web Bot Auth

- Purpose tags `agent-browser-auth` (looking) and `agent-payer-auth` (paying).
- Required parameters: `created`, `expires`, `keyid`, `nonce`, `tag`. The window `expires - created` may be at most 480 seconds (configurable), with 60 seconds of clock skew.
- The nonce is stored until the signature expires; a second use is blocked as a replay. The check runs after the signature check, so an attacker can't burn a real agent's nonce with a forged request.

## Visa Trusted Agent Protocol

- Keys come from `https://mcp.visa.com/.well-known/jwks` (`KNOWN_DIRECTORIES.visa`).
- **Consumer recognition object** and **payment container object** in the body are checked: each must carry the header signature's nonce and key id, and its own signature must verify.
- **Assumption:** the body objects are signed over their RFC 8785 canonical JSON with the `signature` field removed. The spec doesn't say this yet; it's asked in [visa/trusted-agent-protocol#23](https://github.com/visa/trusted-agent-protocol/issues/23). If the answer differs, only `src/bodyObjects.ts` changes.
- ProveTheBuy never decrypts the payment container. It checks the binding and stores a hash.

## Mastercard Agent Pay and Verifiable Intent

Verifiable Intent is modelled as three layers:

| Layer | Signed by | Holds |
| --- | --- | --- |
| L1 | Card issuer | SD-JWT naming the user's key (`cnf.jwk`) |
| L2 | User | SD-JWT with the constraints (amount, merchants, items), the mode (`autonomous` or `attended`), and the agent's key |
| L3 | Agent | JWT with `transaction_id` set to the order hash |

Each layer carries `prev`, the SHA-256 of the layer before it, so they can't be mixed between purchases. ProveTheBuy checks every signature, every link, the expiry, that L3's `transaction_id` equals the hash of the checkout actually presented, and that the order sits inside L2's constraints.

**Status: preview.** The layer layout follows the published Verifiable Intent drafts and its reference implementation; field names may change before Mastercard finalises it.

## AP2

- **Cart mandate:** the merchant's signature (checked against your own `merchantJwk`) and the user's signature over the same cart.
- **Intent mandate:** a user-signed intent without a fixed cart. Orders above `limits.intent_mandate_max_order` step up, because nobody saw the final cart.
- **Open question:** AP2 doesn't yet say how a merchant should trust the user's key. ProveTheBuy reports this as a `mandate_user_key_trust` note rather than pretending to know.

## Stripe shared payment tokens and ACP

The token's allowance is checked against the order: `max_amount`, `currency`, `merchant_id`, `expires_at`. Only the limits; the token itself is redeemed by Stripe as usual.

## Who approved the purchase

A mandate can verify perfectly and still prove nothing about the shopper, if the agent holds the key that signed it. ProveTheBuy compares the key the approval was signed with (the Verifiable Intent layer 1 user key, or the AP2 user key) against the key that signed the HTTP request. If they are the same key, the agent approved its own purchase: the `approval_independent` check fails and the order steps up, or blocks with `approval.on_self_approved: block`. An evidence pack for such an order is not marked submittable.

This follows the warning in the Accountable Agents Framework paper (Appendix C): if the agent can reach the principal's authorisation secrets, a principal-attested authorisation gives no more assurance than the agent vouching for itself.

## Accountable Agents Framework IDs (preview)

The [Accountable Agents Framework](https://civics.com) has directories verify the person or organisation behind an agent and issue the agent pseudonymous IDs. A merchant checks an ID offline with the directory's public key and learns nothing about the principal by default. If something goes wrong, the directory can trace the ID back under its incident process.

ProveTheBuy reads an ID from the request body:

```json
"agent_id": { "type": "aaf", "presentation": "<SD-JWT signed by the directory>" }
```

| Claim | Meaning | Check |
| --- | --- | --- |
| `sub` | The ID. Pairwise or single-use; opaque to you. | `agent_id_valid` |
| `aud` | Optional. The merchant id it was issued for. | `agent_id_valid` |
| `exp` | Expiry. | `agent_id_valid` |
| `cnf.jwk` | The agent's key. Must be the key that signed the request, or the ID was lifted from another agent. | `agent_id_bound` |
| `assurance` | Optional, selectively disclosed. How the principal was verified, for example `IAL2`. | recorded |
| `spending_limit` | Optional, selectively disclosed. `{ amount, currency }` in minor units. | `agent_id_limit` |

Configure ID directories with `agentIds` and, optionally, a revocation lookup with `isAgentIdRevoked`. The ID, its directory and the disclosed claims go into the evidence record and the evidence pack, so you can report an incident back to the directory. AAF is a framework rather than a wire format; this follows its batch-issued SD-JWT VC option and will track the reference implementation.

## Identification levels

Every result says how strongly the client was identified:

| Level | Meaning |
| --- | --- |
| `none` | No name, no signature. Looks like an ordinary browser. |
| `declared` | Writes an agent name in the User-Agent header but does not sign. A claim anyone can type. |
| `verified` | A valid agent signature checked against a trusted key directory. |
| `credentialed` | Verified, plus an Accountable Agents Framework ID tying it to a verified principal. |

Most agent traffic today sits in the first two levels. Arkose Labs reported that 66% of AI agent sessions looked like ordinary Chrome in the week of 16 to 22 November 2026, and nearly half carried no name or signature. Unsigned traffic is returned as `not_agent` and left to your existing fraud tools; ProveTheBuy does not guess.

## Test vectors

`test-vectors/vectors.json` holds signed requests with fixed keys and a fixed clock, each with its expected decision and failing check. They are generated by `npm run vectors` and checked on every `npm test`. Ports to other languages should pass all of them.
