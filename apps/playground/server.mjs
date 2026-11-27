// ProveTheBuy local playground. Run from the repo root: npm run demo
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { EvidenceLedger, MemoryReplayStore, buildEvidencePack, agentSummaries, resolvePolicy, formatMoney } from "@provethebuy/verify";
import { analyse, shareLine } from "@provethebuy/cli/traffic";
import { labRoute } from "./lab.mjs";
import { SCENARIOS, buildScenario, makeVerifier, simulateDay, openDisputes, directories, AGENTS, MERCHANT_ID, ORIGIN } from "./demo.mjs";

const PORT = Number(process.env.PORT ?? 4319);
const HOST = process.env.HOST ?? "127.0.0.1";
const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));

const DEFAULT_POLICY_YAML = `# Edit and press "Dry run" to see how decisions would change.
version: v1
mode: shadow            # shadow: record only. enforce: apply decisions.
fail: open

agents:
  require_signature_for: [agent-payer-auth]
  directories: [visa, mastercard]
  max_window_seconds: 480
  clock_skew_seconds: 60

mandate:
  accept: [verifiable-intent, ap2-cart, ap2-intent]
  on_missing: step_up   # allow | step_up | block
  on_outside: step_up   # step_up | block

limits:
  require_merchant_match: true
  intent_mandate_max_order: 50000

reputation:
  step_up_if_agent_dispute_rate_over: 0.05
  min_orders_for_reputation: 10
`;

const PLANS = [
  {
    id: "indie",
    name: "Indie",
    price_display: "$9 / mo",
    price_cents: 900,
    product_id: "pdt_0NpdSRPqTUSbaTSpIT3qd",
    checkout_url: "https://dodo.pe/provethebuy-indie",
    description: "For indie developers and solo builders.",
    features: [
      "Up to 10k verified requests / mo",
      "Full verifier + policy editor",
      "Evidence ledger (30 days)",
      "Dispute pack export",
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price_display: "$49 / mo",
    price_cents: 4900,
    product_id: "pdt_0NpdSRTwKbMGXXu5lXCoO",
    checkout_url: "https://dodo.pe/provethebuy-pro",
    description: "For growing teams and production stores.",
    features: [
      "Up to 500k verified requests / mo",
      "Everything in Indie",
      "Enforce mode (live blocking)",
      "Agent directory integrations",
      "Reputation signals",
      "Email support",
    ],
    highlighted: true,
  },
  {
    id: "scale",
    name: "Scale",
    price_display: "$199 / mo",
    price_cents: 19900,
    product_id: "pdt_0NpdSRXWPiqPEjkzvh1QN",
    checkout_url: "https://dodo.pe/provethebuy-scale",
    description: "For high-volume merchants and enterprises.",
    features: [
      "Unlimited verified requests",
      "Everything in Pro",
      "Custom mandate policies",
      "Audit log export",
      "SLA + dedicated support",
    ],
  },
];

const state = {};

async function boot() {
  state.policyYaml = DEFAULT_POLICY_YAML;
  state.policy = resolvePolicy(YAML.parse(DEFAULT_POLICY_YAML));
  state.ledger = new EvidenceLedger(MERCHANT_ID);
  state.replay = new MemoryReplayStore();
  state.disputeState = new Map(); // dispute_id -> latest status
  state.lastValid = null;
  await simulateDay({ ledger: state.ledger, policy: state.policy, replay: state.replay });
  for (const d of openDisputes(state.ledger)) state.disputeState.set(d.dispute_id, d);

  // Seed threat sessions for the Threat Check screen
  const now = new Date();
  const ts = (sec) => new Date(now.getTime() - (3600 - sec) * 1000).toISOString();
  state.threatSessions = [
    {
      id: 1, session_key: "c:sess_attack_1", score: 82, decision: "block", event_count: 14,
      first_seen: ts(0), last_seen: ts(300), accounts_touched: 5,
      signals: [
        { rule: "recon_footprint", weight: 18, reason: "4 recon requests (robots.txt, /sitemap.xml, /.well-known/openapi.json +1) before interacting with the site" },
        { rule: "auth_sweep", weight: 25, reason: "5 accounts touched; 5 auth requests in 18s; 3 failed/invalid token attempts" },
        { rule: "api_then_browser", weight: 19, reason: "3 failed API calls (401/403) followed by a browser session 4min later on the same identity" },
        { rule: "model_loop_timing", weight: 15, reason: '6 think-pause gaps (3.8s avg) with 4 bursts and 0 idle periods — consistent with LLM-in-the-loop timing' },
      ],
    },
    {
      id: 2, session_key: "c:sess_attack_2", score: 52, decision: "step_up", event_count: 12,
      first_seen: ts(600), last_seen: ts(648), accounts_touched: 1,
      signals: [
        { rule: "claim_vs_proof", weight: 25, reason: "User-Agent claims perplexity but 12 requests carry no valid agent signature" },
        { rule: "model_loop_timing", weight: 17, reason: '10 think-pause gaps (4.0s avg) with 6 bursts and 0 idle periods — consistent with LLM-in-the-loop timing' },
      ],
    },
    {
      id: 3, session_key: "c:sess_good_agent", score: 0, decision: "allow", event_count: 3,
      first_seen: ts(900), last_seen: ts(910), accounts_touched: 0,
      signals: [],
    },
    {
      id: 4, session_key: "c:sess_human_1", score: 0, decision: "allow", event_count: 4,
      first_seen: ts(1200), last_seen: ts(1380), accounts_touched: 1,
      signals: [],
    },
  ];

  // Seed confirmations for the step-up screen
  const recs = state.ledger.verifications().filter((r) => r.decision === "allow" && r.order);
  state.confirmations = [
    { id: "conf_pg_approved", status: "approved", agent: agentName(recs[0]?.agent?.keyid), amount_display: formatMoney(recs[0]?.order?.amount ?? 3200, "usd"), items: ["House espresso beans, 1 kg"], order_hash: recs[0]?.order?.order_hash ?? "oh_1", decided_at: new Date(Date.now() - 2 * 86400e3).toISOString(), expires_at: new Date(Date.now() + 86400e3).toISOString() },
    { id: "conf_pg_declined", status: "declined", agent: agentName(recs[1]?.agent?.keyid), amount_display: formatMoney(recs[1]?.order?.amount ?? 8900, "usd"), items: ["Pour-over kettle"], order_hash: recs[1]?.order?.order_hash ?? "oh_2", decided_at: new Date(Date.now() - 86400e3).toISOString(), expires_at: new Date(Date.now() + 86400e3).toISOString() },
    { id: "conf_pg_pending", status: "pending", agent: agentName(recs[2]?.agent?.keyid), amount_display: formatMoney(recs[2]?.order?.amount ?? 4999, "usd"), items: ["Single-origin Ethiopia, 250 g"], order_hash: recs[2]?.order?.order_hash ?? "oh_3", decided_at: null, expires_at: new Date(Date.now() + 86400e3).toISOString() },
  ];
}

const agentName = (keyid) => Object.values(AGENTS).find((a) => a.kid === keyid)?.label ?? keyid;

function summary(rec) {
  return {
    record_id: rec.record_id,
    received_at: rec.received_at,
    method: rec.request.method,
    path: rec.request.path,
    agent: rec.agent ? agentName(rec.agent.keyid) : null,
    keyid: rec.agent?.keyid ?? null,
    protocol: rec.agent?.protocol ?? null,
    tag: rec.agent?.tag ?? null,
    decision: rec.decision,
    enforced: rec.enforced,
    reason: rec.reasons[0] ?? "",
    amount: rec.order?.amount ?? null,
    amount_display: rec.order?.amount != null ? formatMoney(rec.order.amount, rec.order.currency) : null,
    mandate: rec.mandate?.type ?? null,
    failed: rec.checks.filter((c) => c.status === "fail").map((c) => c.name),
  };
}

function report() {
  const recs = state.ledger.verifications();
  const now = Date.now();
  const buckets = Array.from({ length: 24 }, (_, i) => ({ hour: new Date(now - (23 - i) * 3600e3).toISOString().slice(0, 13) + ":00", allow: 0, step_up: 0, block: 0, not_agent: 0 }));
  const idx = (iso) => 23 - Math.floor((now - Date.parse(iso)) / 3600e3);
  const by = (f) => recs.reduce((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});
  for (const r of recs) {
    const i = idx(r.received_at);
    if (i >= 0 && i < 24) buckets[i][r.decision]++;
  }
  const agentReqs = recs.filter((r) => r.decision !== "not_agent");
  const failures = {};
  for (const r of recs) for (const c of r.checks) if (c.status === "fail") failures[c.name] = (failures[c.name] ?? 0) + 1;
  return {
    merchant: MERCHANT_ID,
    totals: {
      agent_requests: agentReqs.length,
      verified: recs.filter((r) => r.checks.some((c) => c.name === "signature_valid" && c.status === "pass")).length,
      allowed: recs.filter((r) => r.decision === "allow").length,
      step_ups: recs.filter((r) => r.decision === "step_up").length,
      blocked: recs.filter((r) => r.decision === "block").length,
      paying: recs.filter((r) => r.agent?.tag === "agent-payer-auth").length,
      checkout_value: recs.filter((r) => r.decision === "allow" && r.order?.amount).reduce((s, r) => s + r.order.amount, 0),
    },
    hourly: buckets,
    by_protocol: by((r) => r.agent?.protocol ?? "unknown"),
    by_failure: Object.entries(failures).sort((a, b) => b[1] - a[1]),
    agents: agentSummaries(state.ledger).map((a) => ({ ...a, name: agentName(a.keyid) })),
  };
}

function disputes() {
  return [...state.disputeState.values()].map((d) => {
    const rec = state.ledger.get(d.verification_record_id);
    const opened = Date.parse(d.received_at);
    return {
      dispute_id: d.dispute_id,
      status: d.status,
      reason_code: d.reason_code,
      amount: d.amount,
      amount_display: formatMoney(d.amount, d.currency),
      currency: d.currency,
      agent: agentName(d.agent_keyid),
      payment_intent: d.payment_intent,
      record_id: d.verification_record_id,
      opened_at: d.received_at,
      respond_by: new Date(opened + 7 * 86400e3).toISOString(),
      mandate: rec?.mandate?.type ?? null,
    };
  });
}

async function packFor(id) {
  const d = state.disputeState.get(id);
  if (!d) throw httpError(404, "No dispute with that id.");
  const rec = state.ledger.get(d.verification_record_id);
  const { issuers } = directories();
  return buildEvidencePack(rec, { dispute_id: d.dispute_id, reason_code: d.reason_code, amount: d.amount, currency: d.currency }, state.ledger, {
    merchantId: MERCHANT_ID,
    issuers,
    policy: state.policy,
  });
}

async function dryRun(yamlText) {
  const parsed = YAML.parse(yamlText);
  const candidate = resolvePolicy(parsed);
  const current = YAML.parse(state.policyYaml);
  const recs = state.ledger.verifications().filter((r) => r.artifacts?.request);
  const changes = [];
  const counts = { before: {}, after: {} };
  // Re-run every stored request under the current and the candidate policy, at its original time,
  // so the comparison isolates the policy change.
  const run = async (policy, r, t) => {
    const v = makeVerifier({ policy, ledger: state.ledger, replay: new MemoryReplayStore(), now: () => t });
    const res = await v.verify(r.artifacts.request, r.artifacts.context);
    // A second copy of a replayed request stays a replay.
    return r.checks.some((c) => c.name === "nonce_unused" && c.status === "fail") ? { decision: "block", reasons: ["Replayed request."] } : res;
  };
  for (const r of recs) {
    const t = r.agent?.created ? r.agent.created + 1 : Math.floor(Date.parse(r.received_at) / 1000);
    const before = await run(current, r, t);
    const after = await run(parsed, r, t);
    counts.before[before.decision] = (counts.before[before.decision] ?? 0) + 1;
    counts.after[after.decision] = (counts.after[after.decision] ?? 0) + 1;
    if (after.decision !== before.decision)
      changes.push({ ...summary(r), decision: before.decision, after: after.decision, after_reason: after.reasons.join(" ") });
  }
  return { policy_version: candidate.version, checked: recs.length, changed: changes.length, counts, changes: changes.slice(0, 200) };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5_000_000) throw httpError(413, "Body is larger than 5 MB.");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const json = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
};

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const m = req.method;

  if (!p.startsWith("/api/")) {
    // The console SPA is served at / and /app; the playground lab at /playground. The marketing site lives in apps/site.
    const requestedFile = ["/playground", "/playground/"].includes(p) ? "lab.html" : ["/", "/app", "/app/"].includes(p) ? "app.html" : p;
    const file = normalize(join(PUBLIC, requestedFile));
    if (!file.startsWith(PUBLIC)) throw httpError(403, "Forbidden");
    try {
      const data = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
      return res.end(data);
    } catch {
      // Unknown paths fall back to the playground
      const data = await readFile(join(PUBLIC, "app.html"));
      res.writeHead(200, { "content-type": MIME[".html"] });
      return res.end(data);
    }
  }

  if (p.startsWith("/api/lab/")) return labRoute(req, res, url, { body, json });
  if (m === "GET" && p === "/api/state")
    return json(res, 200, { merchant: MERCHANT_ID, origin: ORIGIN, mode: state.policy.mode, policy_version: state.policy.version, records: state.ledger.size, open_disputes: disputes().filter((d) => d.status === "opened").length });
  if (m === "GET" && p === "/api/scenarios") return json(res, 200, SCENARIOS);

  let mm;
  if (m === "POST" && (mm = p.match(/^\/api\/scenarios\/([\w-]+)\/build$/))) {
    if (mm[1] === "replay" && state.lastValid) return json(res, 200, { request: state.lastValid, note: "This is the last valid request you verified, unchanged." });
    return json(res, 200, { request: buildScenario(mm[1]) });
  }
  if (m === "POST" && p === "/api/verify") {
    const { request } = JSON.parse(await body(req));
    if (!request?.url || !request?.method) throw httpError(400, "Send { request: { method, url, headers, body } }.");
    request.headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const v = makeVerifier({ policy: state.policy, ledger: state.ledger, replay: state.replay });
    const result = await v.verify(request);
    let context;
    try { context = request.body ? JSON.parse(request.body) : undefined; } catch { context = undefined; }
    const rec = state.ledger.record(result, { request, context, paymentIntent: result.decision === "allow" && context?.order ? "pi_pg_" + Date.now().toString(36) : undefined });
    if (result.decision === "allow" && request.headers["signature"]) state.lastValid = request;
    return json(res, 200, { result: { ...result, agentKeyJwk: undefined }, record_id: rec.record_id, agent_name: result.agent ? agentName(result.agent.keyid) : null });
  }
  if (m === "GET" && p === "/api/report") return json(res, 200, report());
  if (m === "GET" && p === "/api/requests") {
    const d = url.searchParams.get("decision");
    const list = state.ledger.verifications().filter((r) => !d || d === "all" || r.decision === d).reverse().map(summary);
    return json(res, 200, list);
  }
  if (m === "GET" && (mm = p.match(/^\/api\/requests\/([\w-]+)$/))) {
    const rec = state.ledger.get(mm[1]);
    if (!rec) throw httpError(404, "No record with that id.");
    return json(res, 200, { ...rec, agent_name: rec.agent ? agentName(rec.agent.keyid) : null });
  }
  if (m === "GET" && p === "/api/policy") return json(res, 200, { yaml: state.policyYaml, version: state.policy.version, mode: state.policy.mode });
  if (m === "POST" && p === "/api/policy/dry-run") {
    const { yaml } = JSON.parse(await body(req));
    try {
      return json(res, 200, await dryRun(yaml));
    } catch (e) {
      throw httpError(400, `Policy is not valid: ${e.message}`);
    }
  }
  if (m === "PUT" && p === "/api/policy") {
    const { yaml } = JSON.parse(await body(req));
    try {
      state.policy = resolvePolicy(YAML.parse(yaml));
      state.policyYaml = yaml;
    } catch (e) {
      throw httpError(400, `Policy is not valid: ${e.message}`);
    }
    return json(res, 200, { version: state.policy.version, mode: state.policy.mode });
  }
  if (m === "GET" && p === "/api/disputes") return json(res, 200, disputes());
  if (m === "GET" && (mm = p.match(/^\/api\/disputes\/([\w-]+)\/pack$/))) return json(res, 200, await packFor(mm[1]));
  if (m === "POST" && (mm = p.match(/^\/api\/disputes\/([\w-]+)\/(submit|won|lost)$/))) {
    const d = state.disputeState.get(mm[1]);
    if (!d) throw httpError(404, "No dispute with that id.");
    const status = mm[2] === "submit" ? "evidence_submitted" : mm[2];
    if (status === "evidence_submitted") {
      const pack = await packFor(mm[1]);
      if (!pack.submittable) throw httpError(409, "This record did not re-verify, so its evidence cannot be submitted.");
    }
    const rec = state.ledger.recordDispute({ dispute_id: d.dispute_id, payment_intent: d.payment_intent, verification_record_id: d.verification_record_id, agent_keyid: d.agent_keyid, status, reason_code: d.reason_code, amount: d.amount, currency: d.currency });
    state.disputeState.set(d.dispute_id, { ...rec, received_at: d.received_at });
    return json(res, 200, { status });
  }
  if (m === "GET" && p === "/api/agents") return json(res, 200, report().agents);
  if (m === "GET" && (mm = p.match(/^\/api\/agents\/([\w-]+)$/))) {
    const agents = report().agents;
    const agent = agents.find((a) => a.keyid === mm[1]);
    if (!agent) throw httpError(404, "No agent with that key id.");
    const recs = state.ledger.verifications().filter((r) => r.agent?.keyid === mm[1]);
    const disp = disputes().filter((d) => state.ledger.get(d.record_id)?.agent?.keyid === mm[1]);
    return json(res, 200, {
      ...agent,
      stores: [{ store_id: "playground", name: "Playground Store" }],
      key_log: [
        { event: "first_seen", protocol: "rfc9421", directory: agent.directory ?? "visa", at: recs[0]?.received_at ?? new Date().toISOString() },
      ],
      recent_orders: recs.slice(-10).map(summary),
      dispute_count: disp.length,
      dispute_rate: recs.length >= 10 ? disp.length / recs.length : null,
    });
  }
  if (m === "GET" && p === "/api/threats") {
    return json(res, 200, { sessions: state.threatSessions ?? [] });
  }
  if (m === "GET" && p === "/api/threats/summary") {
    const sessions = state.threatSessions ?? [];
    return json(res, 200, {
      total_sessions: sessions.length,
      blocked: sessions.filter((s) => s.decision === "block").length,
      stepped_up: sessions.filter((s) => s.decision === "step_up").length,
      allowed: sessions.filter((s) => s.decision === "allow").length,
      avg_score: sessions.length ? Math.round(sessions.reduce((s, t) => s + t.score, 0) / sessions.length) : 0,
      max_score: sessions.length ? Math.max(...sessions.map((s) => s.score)) : 0,
    });
  }
  if (m === "GET" && p === "/api/confirmations") {
    return json(res, 200, state.confirmations ?? []);
  }
  if (m === "GET" && p === "/api/disputes/export") {
    const format = url.searchParams.get("format") ?? "generic";
    const disps = disputes();
    const header = format === "visa" ? "ARN,TC40_Date,Dispute_ID,Amount,Currency,Agent,Reason_Code,Record_ID,Verdict"
      : format === "mastercard" ? "GCMS_Ref,Date,Dispute_ID,Amount,Currency,Agent,Reason_Code,Record_ID,Verdict"
      : "dispute_id,amount,currency,agent,reason_code,record_id,status,opened_at,respond_by";
    const rows = disps.map((d) => {
      if (format === "visa") return `ARN_${d.dispute_id},${d.opened_at?.slice(0,10)},${d.dispute_id},${d.amount},${d.currency},${d.agent},${d.reason_code},${d.record_id},fight`;
      if (format === "mastercard") return `GCMS_${d.dispute_id},${d.opened_at?.slice(0,10)},${d.dispute_id},${d.amount},${d.currency},${d.agent},${d.reason_code},${d.record_id},fight`;
      return `${d.dispute_id},${d.amount},${d.currency},${d.agent},${d.reason_code},${d.record_id},${d.status},${d.opened_at},${d.respond_by}`;
    });
    const csv = [header, ...rows].join("\n");
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="provethebuy-disputes-${format}.csv"` });
    return res.end(csv);
  }
  if (m === "GET" && p === "/api/ledger/verify") return json(res, 200, state.ledger.verifyChain());
  if (m === "POST" && p === "/api/traffic-check") {
    const text = await body(req);
    const r = analyse(text.split("\n"));
    return json(res, 200, { ...r, share: shareLine(r) });
  }
  if (m === "GET" && p === "/api/sample-log") {
    const text = await readFile(fileURLToPath(new URL("../../packages/cli/samples/access.log", import.meta.url)), "utf8");
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end(text);
  }
  if (m === "POST" && p === "/api/reset") {
    await boot();
    return json(res, 200, { ok: true });
  }
  if (m === "GET" && p === "/api/plans") {
    return json(res, 200, PLANS);
  }
  if (m === "POST" && (mm = p.match(/^\/api\/checkout\/(indie|pro|scale)$/))) {
    const plan = PLANS.find((x) => x.id === mm[1]);
    if (!plan) throw httpError(404, "Unknown plan.");
    return json(res, 200, { checkout_url: plan.checkout_url });
  }
  throw httpError(404, "Unknown API route.");
}

export { boot, route };

// Only start the HTTP server when run directly (not imported by Vercel handler)
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1].replace(/\\/g, "/")) {
  await boot();
  createServer((req, res) => {
    route(req, res).catch((e) => json(res, e.status ?? 500, { error: e.message }));
  }).listen(PORT, HOST, () => {
    const line = "─".repeat(52);
    console.log(`\n  ${line}\n  ProveTheBuy playground is running\n\n  Open  http://localhost:${PORT}\n\n  ${state.ledger.size} simulated requests loaded for ${MERCHANT_ID}.\n  Everything runs on your machine. Press Ctrl+C to stop.\n  ${line}\n`);
  });
}
