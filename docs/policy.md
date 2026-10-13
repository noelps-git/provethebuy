# Policy

The policy decides what each combination of check results means for your store. It is one YAML file (or a plain object in code). Anything you leave out takes the default.

```bash
npx provethebuy init        # writes provethebuy.policy.yaml with every option
```

## All options

```yaml
version: v1               # optional. Defaults to a hash of the contents.
mode: shadow              # shadow | enforce
fail: open                # open | closed

agents:
  require_signature_for: [agent-payer-auth]
  directories: [visa, mastercard]   # empty = trust every configured directory
  max_window_seconds: 480
  clock_skew_seconds: 60

mandate:
  accept: [verifiable-intent, ap2-cart, ap2-intent]
  on_missing: step_up     # allow | step_up | block
  on_outside: step_up     # step_up | block

limits:
  require_merchant_match: true
  intent_mandate_max_order: 50000    # minor units ($500.00). 0 turns it off.

reputation:
  step_up_if_agent_dispute_rate_over: 0.02
  min_orders_for_reputation: 20
```

| Option | Default | Meaning |
| --- | --- | --- |
| `mode` | `shadow` | `shadow` records every decision and never blocks. `enforce` returns 403 for block and 409 for step-up. |
| `fail` | `open` | If the verifier itself throws: `open` lets the order through as normal traffic, `closed` blocks it. Either way it's recorded. |
| `agents.require_signature_for` | `[agent-payer-auth]` | Tags that must carry a valid signature. |
| `agents.directories` | all | Which key directories to trust. |
| `agents.max_window_seconds` | `480` | Longest allowed signature lifetime. Visa TAP uses 8 minutes. |
| `agents.clock_skew_seconds` | `60` | Tolerance for clocks that disagree. |
| `mandate.accept` | all three | Mandate types you accept. |
| `mandate.on_missing` | `step_up` | A paying agent with no mandate. |
| `mandate.on_outside` | `step_up` | A valid mandate, but this order is outside its limits. |
| `limits.require_merchant_match` | `true` | Block orders addressed to a different merchant id. |
| `limits.intent_mandate_max_order` | `50000` | Above this, an intent-only mandate steps up. |
| `reputation.step_up_if_agent_dispute_rate_over` | `0.02` | An agent key with a higher dispute rate at your store steps up. |
| `reputation.min_orders_for_reputation` | `20` | Don't judge an agent on fewer orders than this. |

## What step-up means

`step_up` means "ask the shopper to confirm". How you do that is up to you: a 3-D Secure challenge, a confirmation link, or a message back to the agent asking it to get the shopper's approval. In enforce mode the middleware returns `409` with the reasons; in shadow mode you can read `req.provethebuy.stepUp` and decide yourself.

## Changing policy safely

1. Edit the file.
2. Dry-run it against recorded traffic (the playground's **Policy** screen does this; in code, re-run `withPolicy(candidate).verify()` over stored records).
3. Look at which decisions change and why.
4. Apply it. New records carry the new `policy_version`.
