/** Merchant policy: turns check results into allow / step-up / block. */
import { canonicalize, sha256Hex } from "./util.js";

export interface Policy {
  version?: string;
  /** shadow: record decisions but never block. enforce: apply them. */
  mode: "shadow" | "enforce";
  /** What to do if verification code throws. open = treat as normal traffic. */
  fail: "open" | "closed";
  agents: {
    /** Tags that must carry a valid signature. */
    require_signature_for: string[];
    /** Directory names to trust. Empty = all configured directories. */
    directories: string[];
    /** Largest allowed expires - created, in seconds. Visa TAP uses 8 minutes. */
    max_window_seconds: number;
    /** Allowed clock skew, in seconds. */
    clock_skew_seconds: number;
  };
  mandate: {
    accept: string[];
    /** What happens to a paying agent request with no valid mandate. */
    on_missing: "allow" | "step_up" | "block";
    on_outside: "step_up" | "block";
  };
  limits: {
    require_merchant_match: boolean;
    /** Above this total (minor units), an intent-only mandate triggers a step-up. 0 = off. */
    intent_mandate_max_order: number;
  };
  reputation: {
    step_up_if_agent_dispute_rate_over: number;
    min_orders_for_reputation: number;
  };
}

export const DEFAULT_POLICY: Policy = {
  mode: "shadow",
  fail: "open",
  agents: { require_signature_for: ["agent-payer-auth"], directories: [], max_window_seconds: 480, clock_skew_seconds: 60 },
  mandate: { accept: ["verifiable-intent", "ap2-cart", "ap2-intent"], on_missing: "step_up", on_outside: "step_up" },
  limits: { require_merchant_match: true, intent_mandate_max_order: 50000 },
  reputation: { step_up_if_agent_dispute_rate_over: 0.02, min_orders_for_reputation: 20 },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };
export type PolicyInput = DeepPartial<Policy>;

export function resolvePolicy(input: PolicyInput = {}): Policy {
  const p: Policy = {
    ...DEFAULT_POLICY,
    ...input,
    agents: { ...DEFAULT_POLICY.agents, ...(input.agents ?? {}) },
    mandate: { ...DEFAULT_POLICY.mandate, ...(input.mandate ?? {}) },
    limits: { ...DEFAULT_POLICY.limits, ...(input.limits ?? {}) },
    reputation: { ...DEFAULT_POLICY.reputation, ...(input.reputation ?? {}) },
  } as Policy;
  if (!["shadow", "enforce"].includes(p.mode)) throw new Error(`policy.mode must be "shadow" or "enforce"`);
  if (!["open", "closed"].includes(p.fail)) throw new Error(`policy.fail must be "open" or "closed"`);
  if (p.agents.max_window_seconds <= 0 || p.agents.max_window_seconds > 3600) throw new Error("agents.max_window_seconds must be between 1 and 3600");
  p.version = input.version ?? "p_" + sha256Hex(canonicalize({ ...p, version: undefined })).slice(0, 8);
  return p;
}
