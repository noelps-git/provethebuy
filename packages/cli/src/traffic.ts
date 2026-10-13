/**
 * Agent traffic check: reads a day of access logs and counts requests from AI agents.
 *
 * Two signals:
 *   - signed: the request carried Signature-Input / Signature-Agent headers (only visible in JSON
 *     logs that include headers). These can be verified.
 *   - claimed: the User-Agent names a known AI agent or crawler. Anyone can send these strings,
 *     so treat them as a lower bound of interest, not proof.
 */

export interface KnownAgent {
  pattern: RegExp;
  name: string;
  operator: string;
  kind: "user-agent" | "crawler";
}

/** User-triggered agents act for a person in real time; crawlers index content. */
export const KNOWN_AGENTS: KnownAgent[] = [
  { pattern: /ChatGPT-User/i, name: "ChatGPT-User", operator: "OpenAI", kind: "user-agent" },
  { pattern: /ChatGPT[ -]Agent|OpenAI-Operator/i, name: "ChatGPT agent", operator: "OpenAI", kind: "user-agent" },
  { pattern: /OAI-SearchBot/i, name: "OAI-SearchBot", operator: "OpenAI", kind: "crawler" },
  { pattern: /GPTBot/i, name: "GPTBot", operator: "OpenAI", kind: "crawler" },
  { pattern: /Claude-User/i, name: "Claude-User", operator: "Anthropic", kind: "user-agent" },
  { pattern: /Claude-SearchBot/i, name: "Claude-SearchBot", operator: "Anthropic", kind: "crawler" },
  { pattern: /ClaudeBot/i, name: "ClaudeBot", operator: "Anthropic", kind: "crawler" },
  { pattern: /Perplexity-User/i, name: "Perplexity-User", operator: "Perplexity", kind: "user-agent" },
  { pattern: /PerplexityBot/i, name: "PerplexityBot", operator: "Perplexity", kind: "crawler" },
  { pattern: /MistralAI-User/i, name: "MistralAI-User", operator: "Mistral", kind: "user-agent" },
  { pattern: /Google-Agent|GoogleAgent/i, name: "Google agent", operator: "Google", kind: "user-agent" },
  { pattern: /Amazonbot/i, name: "Amazonbot", operator: "Amazon", kind: "crawler" },
  { pattern: /Meta-ExternalAgent|meta-externalfetcher/i, name: "Meta-ExternalAgent", operator: "Meta", kind: "crawler" },
  { pattern: /DuckAssistBot/i, name: "DuckAssistBot", operator: "DuckDuckGo", kind: "crawler" },
  { pattern: /Bytespider/i, name: "Bytespider", operator: "ByteDance", kind: "crawler" },
  { pattern: /CCBot/i, name: "CCBot", operator: "Common Crawl", kind: "crawler" },
];

export interface LogEntry {
  path: string;
  method: string;
  status?: number;
  userAgent: string;
  signed: boolean;
  signatureAgent?: string;
  tag?: string;
}

const COMBINED = /^(\S+) \S+ \S+ \[[^\]]+\] "(\S+) (\S+)[^"]*" (\d{3}) \S+ "[^"]*" "([^"]*)"/;

/** Parse one log line: JSON (with optional headers object) or Apache/Nginx combined format. */
export function parseLine(line: string): LogEntry | null {
  const s = line.trim();
  if (!s) return null;
  if (s.startsWith("{")) {
    try {
      const j = JSON.parse(s) as Record<string, unknown>;
      const h = Object.fromEntries(Object.entries((j.headers ?? j.request_headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]));
      const url = String(j.path ?? j.url ?? j.uri ?? j.request_uri ?? "/");
      const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
      const ua = String(j.user_agent ?? j.userAgent ?? j.http_user_agent ?? h["user-agent"] ?? "");
      const sigInput = h["signature-input"] ?? (j.signature_input as string | undefined);
      const tag = sigInput?.match(/tag="([^"]+)"/)?.[1];
      return {
        path,
        method: String(j.method ?? j.request_method ?? "GET").toUpperCase(),
        status: j.status ? Number(j.status) : undefined,
        userAgent: ua,
        signed: Boolean(sigInput && (h["signature"] ?? j.signature)),
        signatureAgent: h["signature-agent"],
        tag,
      };
    } catch {
      return null;
    }
  }
  const m = COMBINED.exec(s);
  if (!m) return null;
  return { method: m[2].toUpperCase(), path: m[3].split("?")[0], status: Number(m[4]), userAgent: m[5], signed: false };
}

export interface TrafficReport {
  totalRequests: number;
  parsedRequests: number;
  agentRequests: number;
  signedRequests: number;
  payerTagged: number;
  checkoutHits: number;
  byAgent: { name: string; operator: string; kind: string; requests: number; checkoutHits: number; signed: number }[];
  checkoutPaths: string[];
}

export function analyse(lines: string[], checkoutPaths: string[] = ["/checkout", "/cart", "/api/checkout", "/orders"]): TrafficReport {
  const byAgent = new Map<string, TrafficReport["byAgent"][number]>();
  let parsed = 0;
  let agentReq = 0;
  let signed = 0;
  let payer = 0;
  let checkout = 0;
  const isCheckout = (p: string) => checkoutPaths.some((c) => p === c || p.startsWith(c + "/"));
  for (const line of lines) {
    const e = parseLine(line);
    if (!e) continue;
    parsed++;
    const known = KNOWN_AGENTS.find((a) => a.pattern.test(e.userAgent));
    if (!known && !e.signed) continue;
    agentReq++;
    if (e.signed) signed++;
    if (e.tag === "agent-payer-auth") payer++;
    const hit = isCheckout(e.path);
    if (hit) checkout++;
    const host = e.signatureAgent ? (() => { try { return new URL(e.signatureAgent!.replace(/^"|"$/g, "")).host; } catch { return e.signatureAgent; } })() : undefined;
    const key = known?.name ?? (host ? `Signed · ${host}` : "Signed agent");
    const row = byAgent.get(key) ?? { name: key, operator: known?.operator ?? "unknown", kind: known?.kind ?? "user-agent", requests: 0, checkoutHits: 0, signed: 0 };
    row.requests++;
    if (hit) row.checkoutHits++;
    if (e.signed) row.signed++;
    byAgent.set(key, row);
  }
  return {
    totalRequests: lines.filter((l) => l.trim()).length,
    parsedRequests: parsed,
    agentRequests: agentReq,
    signedRequests: signed,
    payerTagged: payer,
    checkoutHits: checkout,
    byAgent: [...byAgent.values()].sort((a, b) => b.requests - a.requests),
    checkoutPaths,
  };
}

export function shareLine(r: TrafficReport): string {
  return `${r.agentRequests.toLocaleString("en-US")} AI-agent requests hit my store in this log, ${r.checkoutHits.toLocaleString("en-US")} of them on checkout. ${r.signedRequests ? r.signedRequests + " were cryptographically signed." : "None were signed."} Checked with ProveTheBuy (open source).`;
}
