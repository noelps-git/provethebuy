import type { Check, MandateInfo, Order } from "../types.js";
import type { KeyDirectory, Jwk } from "../keys.js";
import { verifyVerifiableIntent, type VerifiableIntentMandate } from "./verifiableIntent.js";
import { verifyAp2Cart, verifyAp2Intent, type Ap2CartMandate, type Ap2IntentMandate } from "./ap2.js";

export type Mandate = VerifiableIntentMandate | Ap2CartMandate | Ap2IntentMandate;

export interface MandateContext {
  order: Order;
  orderHash: string;
  now: number;
  merchantId: string;
  /** Directory holding issuer keys for Verifiable Intent layer 1. */
  issuers?: KeyDirectory;
  /** The merchant's own public key, used to check its signature on AP2 cart mandates. */
  merchantJwk?: Jwk;
  /** Mandate types this merchant accepts (policy). */
  accept: string[];
}

export interface MandateOutcome {
  info: MandateInfo;
  checks: Check[];
}

export async function verifyMandate(m: Mandate | undefined, ctx: MandateContext): Promise<MandateOutcome | null> {
  if (!m) return null;
  if (!ctx.accept.includes(m.type)) {
    return {
      info: { type: m.type, valid: false, summary: `Mandate type ${m.type} is not accepted by policy` },
      checks: [{ name: "mandate_valid", status: "fail", detail: `This merchant's policy does not accept ${m.type} mandates.` }],
    };
  }
  switch (m.type) {
    case "verifiable-intent":
      return verifyVerifiableIntent(m, ctx);
    case "ap2-cart":
      return verifyAp2Cart(m, ctx);
    case "ap2-intent":
      return verifyAp2Intent(m, ctx);
    default:
      return {
        info: { type: String((m as { type?: string }).type), valid: false },
        checks: [{ name: "mandate_valid", status: "fail", detail: "Unknown mandate type." }],
      };
  }
}

export type { VerifiableIntentMandate, Ap2CartMandate, Ap2IntentMandate };
