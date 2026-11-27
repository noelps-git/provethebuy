import type { AgentIdInfo } from "./agentId.js";
import type { AgentTag } from "./httpsig.js";
import type { Jwk } from "./keys.js";

export type CheckStatus = "pass" | "fail" | "skip" | "warn";

export interface Check {
  /** Stable machine name, e.g. "signature_valid". */
  name: string;
  status: CheckStatus;
  /** One plain-language sentence a developer can act on. */
  detail: string;
  /** Optional structured data for the inspector. */
  data?: Record<string, unknown>;
}

export type Decision = "allow" | "step_up" | "block" | "not_agent";

export interface Money {
  /** Amount in minor units (cents, paise). */
  amount: number;
  currency: string;
}

export interface OrderItem {
  sku: string;
  name?: string;
  qty: number;
  unit_amount: number;
}

export interface Order {
  id?: string;
  merchant_id: string;
  currency: string;
  total: number;
  items: OrderItem[];
  /** Hashed shipping recipient for anti-triangulation matching (Feature 5). */
  recipient?: { name_hash?: string; address_hash?: string; email_hash?: string };
}

export interface AgentInfo {
  protocol: "visa-tap" | "mastercard-agent-pay" | "web-bot-auth";
  keyid: string;
  tag?: AgentTag | string;
  directory?: string;
  alg?: string;
  keySnapshotSha256?: string;
  nonce?: string;
  created?: number;
  expires?: number;
  /** Accountable Agents Framework ID, when one was presented and verified. */
  agentId?: AgentIdInfo;
}

export interface MandateInfo {
  type: string;
  mode?: string;
  valid: boolean;
  constraintsOk?: boolean;
  expiresAt?: string;
  summary?: string;
  /** Hashed identity of the person who approved the mandate (Feature 5: recipient matching). */
  approver?: { name_hash?: string; address_hash?: string; email_hash?: string };
}

/** What the agent must provide to recover from a step-up (Feature 2). */
export interface StepUpRequirement {
  type: "device-approval" | "aaf-id" | "assurance-level" | "spending-limit" | "body-digest" | "mandate" | "recipient-match";
  detail: string;
  min_value?: string;
}

/** Who vouched for a claim in the verification result (Feature 3). */
export interface ClaimProvenance {
  claim: string;
  source: "directory" | "principal" | "self";
  attester?: string;
  device_type?: string;
}

export interface VerificationResult {
  decision: Decision;
  /** False in shadow mode: the decision is recorded but never applied. */
  enforced: boolean;
  reasons: string[];
  checks: Check[];
  agent?: AgentInfo;
  mandate?: MandateInfo;
  orderHash?: string;
  rawSha256?: string;
  policyVersion: string;
  receivedAt: string;
  /**
   * How strongly the client was identified, weakest to strongest:
   *   none          no name, no signature: looks like an ordinary browser
   *   declared      names itself in the User-Agent header only (easy to fake)
   *   verified      valid agent signature checked against a trusted key directory
   *   credentialed  verified, plus an Accountable Agents Framework ID tying it to a verified principal
   */
  identification?: "none" | "declared" | "verified" | "credentialed";
  /** Agent name found in the User-Agent header, if any. */
  declaredAs?: string;
  /** Public key the agent signed with, kept for the evidence record. */
  agentKeyJwk?: Jwk;
  /** Mandate issuer key used (Verifiable Intent layer 1), kept for re-verification. */
  issuerKeyJwk?: Jwk;
  /** Present when decision is step_up: what to ask the person to confirm. */
  stepUp?: {
    reason: string;
    suggested: "ap2-cart-mandate" | "3ds" | "confirm-in-session";
    /** Structured list of exactly what the agent must provide to recover (Feature 2). */
    required?: StepUpRequirement[];
  };
  /** Who vouched for each claim in the verification (Feature 3). */
  provenance?: ClaimProvenance[];
}
