/**
 * Google Agent Payments Protocol (AP2) mandates.
 *
 * AP2 v0.1 leaves the signing format and the issuance of trusted user keys open. This module
 * accepts compact JWS signatures and reports the user-key trust gap as a warning instead of
 * pretending it is solved. STATUS: preview.
 */
import { verifyJws } from "../jws.js";
import type { Jwk } from "../keys.js";
import { canonicalize } from "../util.js";
import type { Check } from "../types.js";
import type { MandateContext, MandateOutcome } from "./index.js";

export interface Ap2Cart {
  cart_id: string;
  merchant_id: string;
  currency: string;
  total: number;
  items: { sku: string; qty: number; unit_amount: number }[];
  expires_at: string;
}

export interface Ap2CartMandate {
  type: "ap2-cart";
  /** Compact JWS over the cart, signed first by the merchant. */
  merchant_signature: string;
  /** Compact JWS over the same cart, signed by the user's device key. */
  user_signature: string;
  /** The user's public key as presented. Its trust anchor is undefined in AP2 v0.1. */
  user_jwk: Jwk;
}

export interface Ap2IntentMandate {
  type: "ap2-intent";
  /** Compact JWS signed by the user's device key. */
  jws: string;
  user_jwk: Jwk;
}

interface Ap2Intent {
  merchants?: string[];
  max_amount?: { amount: number; currency: string };
  expires_at: string;
  prompt_playback?: string;
}

export async function verifyAp2Cart(m: Ap2CartMandate, ctx: MandateContext): Promise<MandateOutcome> {
  const checks: Check[] = [];
  let userCart: Ap2Cart;
  try {
    userCart = verifyJws<Ap2Cart>(m.user_signature, m.user_jwk).payload;
  } catch (e) {
    checks.push({ name: "mandate_valid", status: "fail", detail: `User signature on the cart mandate failed: ${(e as Error).message}` });
    return { info: { type: m.type, valid: false }, checks };
  }
  if (ctx.merchantJwk) {
    try {
      const merchantCart = verifyJws<Ap2Cart>(m.merchant_signature, ctx.merchantJwk).payload;
      if (canonicalize(merchantCart) !== canonicalize(userCart)) throw new Error("merchant and user signed different carts");
    } catch (e) {
      checks.push({ name: "mandate_valid", status: "fail", detail: `Merchant signature on the cart mandate failed: ${(e as Error).message}` });
      return { info: { type: m.type, valid: false }, checks };
    }
  }
  if (Date.parse(userCart.expires_at) / 1000 < ctx.now) {
    checks.push({ name: "mandate_valid", status: "fail", detail: "The cart mandate has expired." });
    return { info: { type: m.type, valid: false }, checks };
  }
  checks.push({
    name: "mandate_valid",
    status: ctx.merchantJwk ? "pass" : "warn",
    detail: ctx.merchantJwk
      ? "Cart mandate signed by the merchant and the user."
      : "User signature verified. Merchant signature not checked: configure ap2.merchantJwk.",
  });
  checks.push({
    name: "mandate_user_key_trust",
    status: "warn",
    detail: "AP2 v0.1 does not define how user keys are issued, so the user key is trusted as presented.",
  });
  const problems: string[] = [];
  if (userCart.merchant_id !== ctx.merchantId) problems.push("cart is for a different merchant");
  if (userCart.currency.toLowerCase() !== ctx.order.currency.toLowerCase()) problems.push("currency differs");
  if (userCart.total !== ctx.order.total) problems.push(`cart total ${userCart.total} differs from order total ${ctx.order.total}`);
  const norm = (items: Ap2Cart["items"]) => canonicalize([...items].map((i) => ({ sku: i.sku, qty: i.qty, unit_amount: i.unit_amount })).sort((a, b) => a.sku.localeCompare(b.sku)));
  if (norm(userCart.items) !== norm(ctx.order.items)) problems.push("items differ from the signed cart");
  checks.push(
    problems.length
      ? { name: "order_within_mandate", status: "fail", detail: "Order differs from the signed cart: " + problems.join("; ") + "." }
      : { name: "order_within_mandate", status: "pass", detail: "Order is exactly the cart the user signed." },
  );
  return { info: { type: m.type, mode: "human-present", valid: true, constraintsOk: !problems.length, expiresAt: userCart.expires_at, summary: `cart ${userCart.cart_id}` }, checks };
}

export async function verifyAp2Intent(m: Ap2IntentMandate, ctx: MandateContext): Promise<MandateOutcome> {
  const checks: Check[] = [];
  let intent: Ap2Intent;
  try {
    intent = verifyJws<Ap2Intent>(m.jws, m.user_jwk).payload;
  } catch (e) {
    checks.push({ name: "mandate_valid", status: "fail", detail: `Intent mandate signature failed: ${(e as Error).message}` });
    return { info: { type: m.type, valid: false }, checks };
  }
  if (Date.parse(intent.expires_at) / 1000 < ctx.now) {
    checks.push({ name: "mandate_valid", status: "fail", detail: "The intent mandate has expired." });
    return { info: { type: m.type, valid: false }, checks };
  }
  checks.push({ name: "mandate_valid", status: "pass", detail: "Intent mandate signature verified." });
  checks.push({ name: "mandate_user_key_trust", status: "warn", detail: "AP2 v0.1 does not define how user keys are issued, so the user key is trusted as presented." });
  const problems: string[] = [];
  if (intent.merchants && !intent.merchants.includes(ctx.merchantId)) problems.push("merchant not in the intent");
  if (intent.max_amount && ctx.order.total > intent.max_amount.amount) problems.push(`order total exceeds the intent cap ${intent.max_amount.amount}`);
  checks.push(
    problems.length
      ? { name: "order_within_mandate", status: "fail", detail: "Order is outside the intent: " + problems.join("; ") + "." }
      : { name: "order_within_mandate", status: "pass", detail: "Order is inside the intent mandate." },
  );
  return {
    info: { type: m.type, mode: "human-not-present", valid: true, constraintsOk: !problems.length, expiresAt: intent.expires_at, summary: intent.prompt_playback },
    checks,
  };
}
