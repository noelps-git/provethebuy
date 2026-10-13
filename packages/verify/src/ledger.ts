/**
 * Evidence ledger: append-only, hash-chained records. Editing or deleting any record breaks the chain
 * from that point, and verifyChain() says exactly where.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalize, randomId, sha256Hex } from "./util.js";
import type { Jwk } from "./keys.js";
import type { HttpRequestLike } from "./httpsig.js";
import type { AgentInfo, Check, Decision, MandateInfo, VerificationResult } from "./types.js";
import type { CheckoutContext } from "./verify.js";

export interface VerificationRecord {
  type: "verification";
  record_id: string;
  merchant: string;
  received_at: string;
  request: { method: string; authority: string; path: string; raw_sha256?: string };
  agent?: AgentInfo;
  checks: Check[];
  mandate?: MandateInfo;
  order?: { order_hash?: string; order_id?: string; amount?: number; currency?: string; payment_intent?: string };
  policy_version: string;
  decision: Decision;
  enforced: boolean;
  reasons: string[];
  /** Raw material kept so the record can be re-verified months later. */
  artifacts?: { request?: HttpRequestLike; key_jwk?: Jwk; context?: CheckoutContext };
  prev_hash: string;
  hash: string;
}

export interface DisputeRecord {
  type: "dispute";
  record_id: string;
  merchant: string;
  received_at: string;
  dispute_id: string;
  payment_intent?: string;
  verification_record_id?: string;
  agent_keyid?: string;
  status: "opened" | "evidence_submitted" | "won" | "lost";
  reason_code?: string;
  amount?: number;
  currency?: string;
  prev_hash: string;
  hash: string;
}

export type LedgerRecord = VerificationRecord | DisputeRecord;
type Unhashed<T> = Omit<T, "hash" | "prev_hash" | "record_id" | "received_at"> & { received_at?: string };

const GENESIS = "0".repeat(64);

export function recordHash(rec: Omit<LedgerRecord, "hash">): string {
  return sha256Hex(canonicalize(rec));
}

export class EvidenceLedger {
  protected records: LedgerRecord[] = [];

  constructor(protected readonly merchant: string) {}

  get size(): number {
    return this.records.length;
  }

  all(): LedgerRecord[] {
    return [...this.records];
  }

  verifications(): VerificationRecord[] {
    return this.records.filter((r): r is VerificationRecord => r.type === "verification");
  }

  disputes(): DisputeRecord[] {
    return this.records.filter((r): r is DisputeRecord => r.type === "dispute");
  }

  get(recordId: string): LedgerRecord | undefined {
    return this.records.find((r) => r.record_id === recordId);
  }

  findByPayment(paymentIntent: string): VerificationRecord | undefined {
    return this.verifications().find((r) => r.order?.payment_intent === paymentIntent);
  }

  protected persist(_rec: LedgerRecord): void {}

  private listeners: ((rec: LedgerRecord) => void)[] = [];

  /** Call `fn` after every new record (used by connectCloud). Returns a function that removes the listener. */
  onRecord(fn: (rec: LedgerRecord) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  protected appendRaw<T extends LedgerRecord>(partial: Unhashed<T>, prefix: string): T {
    const prev_hash = this.records.length ? this.records[this.records.length - 1].hash : GENESIS;
    const body = { ...partial, record_id: randomId(prefix), received_at: partial.received_at ?? new Date().toISOString(), prev_hash } as Omit<T, "hash">;
    const rec = { ...body, hash: recordHash(body as Omit<LedgerRecord, "hash">) } as T;
    this.records.push(rec);
    this.persist(rec);
    for (const l of this.listeners) {
      try {
        l(rec);
      } catch {
        /* a listener must never break recording */
      }
    }
    return rec;
  }

  /** Append a verification result. Pass the request and context to keep artifacts for re-verification. */
  record(
    result: VerificationResult,
    extra: {
      request: HttpRequestLike;
      context?: CheckoutContext;
      keyJwk?: Jwk;
      orderId?: string;
      paymentIntent?: string;
      storeArtifacts?: boolean;
    },
  ): VerificationRecord {
    const url = new URL(extra.request.url);
    const order = extra.context?.order;
    return this.appendRaw<VerificationRecord>(
      {
        type: "verification",
        merchant: this.merchant,
        received_at: result.receivedAt,
        request: { method: extra.request.method.toUpperCase(), authority: url.host, path: url.pathname, raw_sha256: result.rawSha256 },
        agent: result.agent,
        checks: result.checks,
        mandate: result.mandate,
        order: order ? { order_hash: result.orderHash, order_id: extra.orderId ?? order.id, amount: order.total, currency: order.currency, payment_intent: extra.paymentIntent } : undefined,
        policy_version: result.policyVersion,
        decision: result.decision,
        enforced: result.enforced,
        reasons: result.reasons,
        artifacts: extra.storeArtifacts === false ? undefined : { request: extra.request, key_jwk: extra.keyJwk ?? result.agentKeyJwk, context: extra.context },
      },
      "rec",
    );
  }

  recordDispute(d: Omit<Unhashed<DisputeRecord>, "type" | "merchant">): DisputeRecord {
    return this.appendRaw<DisputeRecord>({ ...d, type: "dispute", merchant: this.merchant }, "dsp");
  }

  /** Recompute every hash and link. Returns the first broken record, if any. */
  verifyChain(): { ok: boolean; checked: number; brokenAt?: string; problem?: string } {
    let prev = GENESIS;
    for (const r of this.records) {
      const { hash, ...body } = r;
      if (r.prev_hash !== prev) return { ok: false, checked: this.records.length, brokenAt: r.record_id, problem: "prev_hash does not link to the previous record" };
      if (recordHash(body) !== hash) return { ok: false, checked: this.records.length, brokenAt: r.record_id, problem: "record contents changed after it was written" };
      prev = hash;
    }
    return { ok: true, checked: this.records.length };
  }

  /** Merkle root of the record hashes received on one UTC day (YYYY-MM-DD), for daily anchoring. */
  merkleRoot(day: string): string | null {
    let level = this.records.filter((r) => r.received_at.startsWith(day)).map((r) => r.hash);
    if (!level.length) return null;
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) next.push(sha256Hex(level[i] + (level[i + 1] ?? level[i])));
      level = next;
    }
    return level[0];
  }
}

/** Ledger persisted as JSON Lines on disk. Good for local use, self-hosting and shadow mode. */
export class FileLedger extends EvidenceLedger {
  constructor(merchant: string, private readonly path: string) {
    super(merchant);
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      this.records = text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerRecord);
    } else {
      mkdirSync(dirname(path), { recursive: true });
    }
  }

  protected override persist(rec: LedgerRecord): void {
    appendFileSync(this.path, JSON.stringify(rec) + "\n");
  }
}
