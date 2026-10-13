/** Per-agent statistics computed from your own ledger. */
import type { EvidenceLedger } from "./ledger.js";
import type { AgentStats, ReputationProvider } from "./verify.js";

export interface AgentSummary extends AgentStats {
  keyid: string;
  protocol?: string;
  directory?: string;
  requests: number;
  blocked: number;
  stepUps: number;
  disputesWon: number;
  disputesLost: number;
  lastSeen?: string;
}

export function agentSummaries(ledger: EvidenceLedger): AgentSummary[] {
  const map = new Map<string, AgentSummary>();
  for (const r of ledger.verifications()) {
    if (!r.agent?.keyid) continue;
    const s =
      map.get(r.agent.keyid) ??
      ({ keyid: r.agent.keyid, protocol: r.agent.protocol, directory: r.agent.directory, requests: 0, orders: 0, blocked: 0, stepUps: 0, disputes: 0, mismatches: 0, disputesWon: 0, disputesLost: 0 } as AgentSummary);
    s.requests++;
    if (r.decision === "allow" && r.order) s.orders++;
    if (r.decision === "block") s.blocked++;
    if (r.decision === "step_up") s.stepUps++;
    if (r.checks.some((c) => c.name === "order_within_mandate" && c.status === "fail")) s.mismatches++;
    if (r.agent.directory) s.directory = r.agent.directory;
    s.lastSeen = r.received_at;
    map.set(r.agent.keyid, s);
  }
  const seenDispute = new Set<string>();
  for (const d of ledger.disputes()) {
    if (!d.agent_keyid) continue;
    const s = map.get(d.agent_keyid);
    if (!s) continue;
    if (d.status === "opened" && !seenDispute.has(d.dispute_id)) {
      s.disputes++;
      seenDispute.add(d.dispute_id);
    }
    if (d.status === "won") s.disputesWon++;
    if (d.status === "lost") s.disputesLost++;
  }
  return [...map.values()].sort((a, b) => b.requests - a.requests);
}

export function ledgerReputation(ledger: EvidenceLedger): ReputationProvider {
  return (keyid) => {
    const s = agentSummaries(ledger).find((a) => a.keyid === keyid);
    return s ? { orders: s.orders, disputes: s.disputes, mismatches: s.mismatches } : undefined;
  };
}
