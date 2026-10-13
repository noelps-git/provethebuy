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
}

export interface MandateInfo {
  type: string;
  mode?: string;
  valid: boolean;
  constraintsOk?: boolean;
  expiresAt?: string;
  summary?: string;
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
  /** Public key the agent signed with, kept for the evidence record. */
  agentKeyJwk?: Jwk;
  /** Present when decision is step_up: what to ask the person to confirm. */
  stepUp?: { reason: string; suggested: "ap2-cart-mandate" | "3ds" | "confirm-in-session" };
}
