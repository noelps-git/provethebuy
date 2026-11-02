# CLI

The `provethebuy` command ships with the same verifier as the library. Use it to count AI-agent traffic in your access logs, write a starter policy, and verify or sign requests from a terminal.

```bash
npx @provethebuy/cli traffic-check /var/log/nginx/access.log
```

## traffic-check

How many AI agents reached your store, how many hit checkout, and how many signed their requests.

```
provethebuy traffic-check <access.log> [--checkout /checkout,/cart] [--json]
```

```
Agent traffic check  access.log

  Requests in log          1,036
  From AI agents           216
  On checkout paths        51  (/checkout, /cart, /api/checkout, /orders)
  Signed (verifiable)      14  (7 declared they were paying)

  Agent                  Operator     Kind        Requests  Checkout
  ChatGPT-User           OpenAI       user-agent        46        27
  GPTBot                 OpenAI       crawler           38         0
  Claude-User            Anthropic    user-agent        19         8
  Perplexity-User        Perplexity   user-agent        11         9

  User-Agent names can be faked; only signed requests can be verified.
```

Logs are read locally and never uploaded. It understands the combined log format used by nginx and Apache. `--json` prints the same numbers for scripts.

## All commands

```
provethebuy traffic-check <access.log> [--checkout /checkout,/cart] [--json]
provethebuy init [--out provethebuy.policy.yaml]
provethebuy keys new <name> [--out agent-key.json]
provethebuy sign <request.json> --key <private-key.json> [--tag agent-payer-auth]
provethebuy verify <request.json> --jwks <jwks.json|url> --merchant <id> [--policy file.yaml]
provethebuy ledger verify <evidence.jsonl>
```

| Command | What it does |
| --- | --- |
| `traffic-check` | Counts AI-agent requests in an access log, by agent and by checkout path |
| `init` | Writes a starter policy file in shadow mode |
| `keys new` | Creates an Ed25519 key pair for testing an agent |
| `sign` | Signs a saved request as an agent would (RFC 9421) |
| `verify` | Verifies a saved request against a key directory and prints every check |
| `ledger verify` | Checks that an evidence ledger's hash chain hasn't been edited |

## Examples

```bash
# Write a starter policy
npx @provethebuy/cli init

# Verify a saved request against the Visa key directory
npx @provethebuy/cli verify request.json --jwks https://mcp.visa.com/.well-known/jwks --merchant acct_your_shop

# Check that an evidence ledger hasn't been edited
npx @provethebuy/cli ledger verify evidence.jsonl
```

From a clone, run `npm run build` and then `node packages/cli/dist/cli.js`. Try `traffic-check packages/cli/samples/access.log` to see sample output.
