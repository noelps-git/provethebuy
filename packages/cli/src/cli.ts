#!/usr/bin/env node
/**
 * provethebuy — command-line tools.
 *
 *   provethebuy traffic-check access.log      count AI-agent requests in a day of logs
 *   provethebuy init                          write a starter policy file
 *   provethebuy keys new "My Agent"           create a test agent key pair
 *   provethebuy sign request.json --key k.json  sign a request like an agent would
 *   provethebuy verify request.json --jwks keys.json --merchant acct_123
 *   provethebuy ledger verify evidence.jsonl  check an evidence ledger's hash chain
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import YAML from "yaml";
import { ProveTheBuy, KeyDirectory, FileLedger, signRequest, type HttpRequestLike, type Jwks, type Jwk } from "@provethebuy/verify";
import { generateKey } from "@provethebuy/verify/testing";
import { analyse, shareLine } from "./traffic.js";

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { b: (s: string) => `\x1b[1m${s}\x1b[0m`, g: (s: string) => `\x1b[32m${s}\x1b[0m`, r: (s: string) => `\x1b[31m${s}\x1b[0m`, y: (s: string) => `\x1b[33m${s}\x1b[0m`, d: (s: string) => `\x1b[2m${s}\x1b[0m` }
  : { b: (s: string) => s, g: (s: string) => s, r: (s: string) => s, y: (s: string) => s, d: (s: string) => s };

function args(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const HELP = `
${C.b("ProveTheBuy")} — proof for orders placed by AI agents

${C.b("Usage")}
  provethebuy traffic-check <access.log> [--checkout /checkout,/cart] [--json]
  provethebuy init [--out provethebuy.policy.yaml]
  provethebuy keys new <name> [--out agent-key.json]
  provethebuy sign <request.json> --key <private-key.json> [--tag agent-payer-auth]
  provethebuy verify <request.json> --jwks <jwks.json|url> --merchant <id> [--policy file.yaml] [--issuers <jwks.json>]
  provethebuy ledger verify <evidence.jsonl>

${C.b("Start here")}
  provethebuy traffic-check /var/log/nginx/access.log
`;

const POLICY_TEMPLATE = `# ProveTheBuy policy — https://github.com/provethebuy/provethebuy/blob/main/docs/policy.md
version: v1
mode: shadow            # shadow: record only, never block. enforce: apply decisions.
fail: open              # if verification itself errors: open = treat as normal traffic

agents:
  require_signature_for: [agent-payer-auth]
  directories: []       # empty = every directory you configure
  max_window_seconds: 480
  clock_skew_seconds: 60

mandate:
  accept: [verifiable-intent, ap2-cart, ap2-intent]
  on_missing: step_up   # allow | step_up | block
  on_outside: step_up   # step_up | block

limits:
  require_merchant_match: true
  intent_mandate_max_order: 50000   # minor units; unattended orders above this need confirmation

reputation:
  step_up_if_agent_dispute_rate_over: 0.02
  min_orders_for_reputation: 20
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = args(rest);

  switch (cmd) {
    case "traffic-check": {
      const file = pos[0];
      if (!file || !existsSync(file)) throw new Error("Give the path to an access log, e.g. provethebuy traffic-check access.log");
      const lines = readFileSync(file, "utf8").split("\n");
      const paths = typeof flags.checkout === "string" ? flags.checkout.split(",") : undefined;
      const r = analyse(lines, paths);
      if (flags.json) return console.log(JSON.stringify(r, null, 2));
      console.log(`\n${C.b("Agent traffic check")}  ${C.d(file)}\n`);
      console.log(`  Requests in log          ${r.totalRequests.toLocaleString()}`);
      console.log(`  From AI agents           ${C.b(r.agentRequests.toLocaleString())}`);
      console.log(`  On checkout paths        ${C.b(r.checkoutHits.toLocaleString())}  ${C.d("(" + r.checkoutPaths.join(", ") + ")")}`);
      console.log(`  Signed (verifiable)      ${r.signedRequests ? C.g(String(r.signedRequests)) : C.y("0")}${r.payerTagged ? `  (${r.payerTagged} declared they were paying)` : ""}\n`);
      if (r.byAgent.length) {
        console.log(`  ${C.b("Agent".padEnd(38))}${C.b("Operator".padEnd(14))}${C.b("Kind".padEnd(12))}${C.b("Requests".padStart(9))}${C.b("Checkout".padStart(10))}`);
        for (const a of r.byAgent.slice(0, 15))
          console.log(`  ${a.name.slice(0, 37).padEnd(38)}${a.operator.padEnd(14)}${a.kind.padEnd(12)}${String(a.requests).padStart(9)}${String(a.checkoutHits).padStart(10)}`);
        console.log();
      }
      console.log(C.d("  User-Agent names can be faked; only signed requests can be verified."));
      console.log(C.d("  Share it:") + " " + shareLine(r) + "\n");
      return;
    }
    case "init": {
      const out = typeof flags.out === "string" ? flags.out : "provethebuy.policy.yaml";
      if (existsSync(out) && !flags.force) throw new Error(`${out} already exists (use --force to overwrite)`);
      writeFileSync(out, POLICY_TEMPLATE);
      console.log(`${C.g("✓")} Wrote ${out}. It starts in shadow mode, so nothing is ever blocked until you change mode to enforce.`);
      return;
    }
    case "keys": {
      if (pos[0] !== "new" || !pos[1]) throw new Error('Usage: provethebuy keys new "Agent name"');
      const kp = generateKey(`${pos[1].toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomBytes(3).toString("hex")}`);
      const out = typeof flags.out === "string" ? flags.out : "agent-key.json";
      writeFileSync(out, JSON.stringify(kp.privateJwk, null, 2), { mode: 0o600 });
      writeFileSync(out.replace(/\.json$/, "") + ".jwks.json", JSON.stringify({ keys: [kp.publicJwk] }, null, 2));
      console.log(`${C.g("✓")} Private key: ${out} (keep it secret)\n${C.g("✓")} Public key set: ${out.replace(/\.json$/, "")}.jwks.json\n  keyid: ${kp.kid}`);
      return;
    }
    case "sign": {
      if (!pos[0] || typeof flags.key !== "string") throw new Error("Usage: provethebuy sign request.json --key agent-key.json");
      const req = readJson<HttpRequestLike>(pos[0]);
      const key = readJson<Jwk>(flags.key);
      const signed = signRequest(
        { ...req, headers: Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])) },
        { privateJwk: key, keyid: String(key.kid), tag: (typeof flags.tag === "string" ? flags.tag : "agent-payer-auth") as "agent-payer-auth", nonce: randomBytes(16).toString("base64url") },
      );
      console.log(JSON.stringify(signed, null, 2));
      return;
    }
    case "verify": {
      if (!pos[0] || typeof flags.jwks !== "string" || typeof flags.merchant !== "string") throw new Error("Usage: provethebuy verify request.json --jwks keys.json --merchant acct_123");
      const req = readJson<HttpRequestLike>(pos[0]);
      const src = flags.jwks.startsWith("http") ? { name: String(flags.directory ?? "remote"), url: flags.jwks } : { name: String(flags.directory ?? "local"), jwks: readJson<Jwks>(flags.jwks) };
      const policy = typeof flags.policy === "string" ? YAML.parse(readFileSync(flags.policy, "utf8")) : { mode: "enforce" };
      const v = new ProveTheBuy({
        merchantId: flags.merchant,
        keys: new KeyDirectory({ sources: [src] }),
        issuers: typeof flags.issuers === "string" ? new KeyDirectory({ sources: [{ name: "issuers", jwks: readJson<Jwks>(flags.issuers) }] }) : undefined,
        policy,
      });
      const res = await v.verify({ ...req, headers: Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])) });
      if (flags.json) return console.log(JSON.stringify(res, null, 2));
      const mark = (s: string) => (s === "pass" ? C.g("✓") : s === "fail" ? C.r("✗") : s === "warn" ? C.y("!") : C.d("·"));
      console.log(`\n${C.b("Decision:")} ${res.decision === "allow" ? C.g("ALLOW") : res.decision === "block" ? C.r("BLOCK") : res.decision === "step_up" ? C.y("STEP-UP") : "NOT AN AGENT"}${res.enforced ? "" : C.d("  (shadow mode: not enforced)")}`);
      console.log(C.d("  " + res.reasons.join(" ")) + "\n");
      for (const c of res.checks) console.log(`  ${mark(c.status)} ${c.name.padEnd(24)} ${c.detail}`);
      console.log();
      process.exitCode = res.decision === "block" ? 2 : 0;
      return;
    }
    case "ledger": {
      if (pos[0] !== "verify" || !pos[1]) throw new Error("Usage: provethebuy ledger verify evidence.jsonl");
      const l = new FileLedger("local", pos[1]);
      const r = l.verifyChain();
      console.log(r.ok ? `${C.g("✓")} Chain intact: ${r.checked} records` : `${C.r("✗")} Chain broken at ${r.brokenAt}: ${r.problem}`);
      process.exitCode = r.ok ? 0 : 2;
      return;
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      throw new Error(`Unknown command "${cmd}". Run provethebuy --help`);
  }
}

main().catch((e) => {
  console.error(`${C.r("Error:")} ${(e as Error).message}`);
  process.exitCode = 1;
});
