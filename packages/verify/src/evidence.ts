/** Re-verify a stored record and build a dispute evidence pack from it. */
import { KeyDirectory } from "./keys.js";
import { MemoryReplayStore } from "./replay.js";
import { ProveTheBuy, type ProveTheBuyOptions } from "./verify.js";
import { formatMoney } from "./order.js";
import type { EvidenceLedger, VerificationRecord } from "./ledger.js";

export interface DisputeInput {
  dispute_id: string;
  reason_code: string;
  network?: "visa" | "mastercard" | "amex" | "other";
  amount: number;
  currency: string;
  opened_at?: string;
}

export interface ReverifyResult {
  ok: boolean;
  detail: string;
  checks: { name: string; status: string; detail: string }[];
}

/**
 * Re-run the signature and mandate checks with the stored raw request and the key snapshot taken at
 * the time, as of the original signing time. Works after the agent's key has rotated.
 */
export async function reverifyRecord(
  rec: VerificationRecord,
  opts: Pick<ProveTheBuyOptions, "merchantId" | "issuers" | "merchantJwk" | "policy">,
): Promise<ReverifyResult> {
  const a = rec.artifacts;
  if (!a?.request || !a.key_jwk || !rec.agent) return { ok: false, detail: "Record has no stored request or key snapshot to re-verify.", checks: [] };
  const keys = new KeyDirectory({ sources: [{ name: rec.agent.directory ?? "snapshot", jwks: { keys: [{ ...a.key_jwk, kid: rec.agent.keyid }] } }] });
  const at = (rec.agent.created ?? Math.floor(Date.parse(rec.received_at) / 1000)) + 1;
  const v = new ProveTheBuy({ ...opts, keys, replay: new MemoryReplayStore(), now: () => at });
  const res = await v.verify(a.request, a.context);
  const sigOk = res.checks.some((c) => c.name === "signature_valid" && c.status === "pass");
  const same = res.decision === rec.decision;
  return {
    ok: sigOk && same,
    detail: sigOk
      ? same
        ? "Re-verified: the stored request still verifies with the key snapshot, and the decision is unchanged."
        : `Signature still verifies, but the decision now differs (${res.decision} vs ${rec.decision}).`
      : "The stored request no longer verifies. Do not submit this record as evidence.",
    checks: res.checks.map(({ name, status, detail }) => ({ name, status, detail })),
  };
}

const REASONS: Record<string, { label: string; focus: string }> = {
  "10.4": { label: "Visa 10.4 Other Fraud, card-absent", focus: "authorisation" },
  "13.1": { label: "Visa 13.1 Merchandise not received", focus: "fulfilment" },
  "13.3": { label: "Visa 13.3 Not as described", focus: "order-match" },
  "4837": { label: "Mastercard 4837 No cardholder authorisation", focus: "authorisation" },
  "4853": { label: "Mastercard 4853 Not as described", focus: "order-match" },
};

export interface EvidencePack {
  dispute_id: string;
  reason: string;
  record_id: string;
  record_hash: string;
  reverification: ReverifyResult;
  submittable: boolean;
  sections: { title: string; body: string }[];
  /** Plain text suitable for Stripe's uncategorized_text evidence field. */
  text: string;
}

export async function buildEvidencePack(
  rec: VerificationRecord,
  dispute: DisputeInput,
  ledger: EvidenceLedger,
  opts: Pick<ProveTheBuyOptions, "merchantId" | "issuers" | "merchantJwk" | "policy">,
): Promise<EvidencePack> {
  const reason = REASONS[dispute.reason_code] ?? { label: `Reason code ${dispute.reason_code}`, focus: "authorisation" };
  const reverification = await reverifyRecord(rec, opts);
  const chain = ledger.verifyChain();
  const pass = (n: string) => rec.checks.find((c) => c.name === n)?.status === "pass";
  const amount = rec.order?.amount !== undefined ? formatMoney(rec.order.amount, rec.order.currency ?? dispute.currency) : "n/a";

  const sections = [
    {
      title: "Summary",
      body:
        `This purchase of ${amount} was placed by an AI agent acting for the cardholder. ` +
        `The agent's identity was verified with a cryptographic signature from the ${rec.agent?.directory ?? "agent"} key directory, ` +
        (rec.mandate?.valid
          ? `and the cardholder's signed mandate (${rec.mandate.type}${rec.mandate.mode ? ", " + rec.mandate.mode : ""}) authorised it: ${rec.mandate.summary ?? "see below"}.`
          : "but no valid cardholder mandate was presented."),
    },
    {
      title: "Agent identity",
      body: [
        `Protocol: ${rec.agent?.protocol}`,
        `Key id: ${rec.agent?.keyid}`,
        `Purpose tag: ${rec.agent?.tag}`,
        `Signed at: ${rec.agent?.created ? new Date(rec.agent.created * 1000).toISOString() : "n/a"}`,
        `Signature verified: ${pass("signature_valid") ? "yes" : "no"}; replay check: ${pass("nonce_unused") ? "passed" : "failed"}`,
        `Key snapshot (SHA-256): ${rec.agent?.keySnapshotSha256}`,
      ].join("\n"),
    },
    {
      title: "Cardholder authorisation",
      body: rec.mandate
        ? [
            `Mandate type: ${rec.mandate.type}`,
            `Mode: ${rec.mandate.mode ?? "n/a"}`,
            `Credential chain valid: ${rec.mandate.valid ? "yes" : "no"}`,
            `Order inside the mandate: ${rec.mandate.constraintsOk ? "yes" : "no"}`,
            `Mandate valid until: ${rec.mandate.expiresAt ?? "n/a"}`,
          ].join("\n")
        : "No mandate was presented with this order.",
    },
    {
      title: "Order match",
      body: [`Order hash (RFC 8785 + SHA-256): ${rec.order?.order_hash}`, `Order id: ${rec.order?.order_id ?? "n/a"}`, `Amount: ${amount}`, `Payment: ${rec.order?.payment_intent ?? "n/a"}`].join("\n"),
    },
    {
      title: "Integrity",
      body: [
        `Record ${rec.record_id}, hash ${rec.hash}`,
        `Ledger chain intact: ${chain.ok ? "yes" : "no, broken at " + chain.brokenAt} (${chain.checked} records checked)`,
        `Re-verification today: ${reverification.detail}`,
      ].join("\n"),
    },
  ];
  if (reason.focus === "fulfilment")
    sections.push({ title: "Fulfilment", body: "Attach the carrier tracking number and delivery confirmation. The agent and mandate evidence above shows who ordered; delivery proof shows it arrived." });

  const submittable = reverification.ok && chain.ok && !!rec.mandate?.valid;
  const text = [`Dispute ${dispute.dispute_id}: ${reason.label}`, ...sections.map((s) => `${s.title.toUpperCase()}\n${s.body}`)].join("\n\n");
  return { dispute_id: dispute.dispute_id, reason: reason.label, record_id: rec.record_id, record_hash: rec.hash, reverification, submittable, sections, text };
}
