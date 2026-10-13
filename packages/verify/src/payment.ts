/**
 * Scoped payment credentials: Stripe shared payment tokens and ACP delegated-payment allowances.
 * Both carry limits (max amount, currency, merchant, expiry). The merchant must never charge outside them.
 */
import type { Check, Order } from "./types.js";

export interface PaymentAllowance {
  max_amount: number;
  currency: string;
  merchant_id?: string;
  /** RFC 3339 or unix seconds. */
  expires_at: string | number;
  checkout_session_id?: string;
  reason?: "one_time" | string;
}

export interface PaymentCredential {
  type: "stripe-spt" | "acp-allowance";
  /** e.g. spt_... or vt_... — never a card number. */
  token: string;
  /** Limits as returned by the PSP (e.g. retrieved from Stripe). */
  allowance: PaymentAllowance;
}

export function checkPaymentLimits(p: PaymentCredential | undefined, order: Order, merchantId: string, now: number): Check {
  if (!p) return { name: "token_limits", status: "skip", detail: "No scoped payment credential in the request." };
  const a = p.allowance;
  const exp = typeof a.expires_at === "number" ? a.expires_at : Math.floor(Date.parse(a.expires_at) / 1000);
  const problems: string[] = [];
  if (a.currency.toLowerCase() !== order.currency.toLowerCase()) problems.push(`token currency ${a.currency} differs from order currency ${order.currency}`);
  if (order.total > a.max_amount) problems.push(`order total ${order.total} exceeds the token cap ${a.max_amount}`);
  if (a.merchant_id && a.merchant_id !== merchantId) problems.push(`token is scoped to merchant ${a.merchant_id}`);
  if (Number.isFinite(exp) && exp < now) problems.push("token has expired");
  return problems.length
    ? { name: "token_limits", status: "fail", detail: "Charging would break the token's limits: " + problems.join("; ") + ".", data: { type: p.type } }
    : { name: "token_limits", status: "pass", detail: `Order fits the ${p.type === "stripe-spt" ? "shared payment token" : "ACP allowance"} limits.`, data: { type: p.type, max_amount: a.max_amount } };
}
