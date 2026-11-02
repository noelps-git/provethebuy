# @provethebuy/cli

Count AI-agent traffic in your access logs, and verify or sign agent requests from the command line.

```bash
npx @provethebuy/cli traffic-check /var/log/nginx/access.log
```

```
provethebuy traffic-check <access.log> [--checkout /checkout,/cart] [--json]
provethebuy init [--out provethebuy.policy.yaml]
provethebuy keys new <name> [--out agent-key.json]
provethebuy sign <request.json> --key <private-key.json> [--tag agent-payer-auth]
provethebuy verify <request.json> --jwks <jwks.json|url> --merchant <id> [--policy file.yaml]
provethebuy ledger verify <evidence.jsonl>
```

Logs are read locally and never uploaded. Docs at [provethebuy.com/docs/cli](https://provethebuy.com/docs/cli). Source on [GitHub](https://github.com/noelps-git/provethebuy).

Apache-2.0
