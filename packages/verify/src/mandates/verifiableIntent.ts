/**
 * Layered intent credentials, modelled on Mastercard Verifiable Intent.
 *
 *   L1  issuer  -> user     SD-JWT, signed by the card issuer, binds the user's key (cnf.jwk)
 *   L2  user    -> agent    SD-JWT, signed by the user's key, carries constraints; in autonomous
 *                           mode it binds the agent's key (cnf.jwk)
 *   L3  agent   -> merchant JWT, signed by the agent key (autonomous) or user key (immediate),
 *                           names the exact checkout; transaction_id must equal our order hash
 *
 * Each layer carries `prev`: the SHA-256 (base64url) of the previous layer as received.
 *
 * STATUS: preview. Field names follow the public description of the specification; they will be
 * aligned with the reference implementation's test vectors (github.com/agent-intent/verifiable-intent)
 * in a later release. See docs/protocols.md.
 */
import { sha256B64url } from "../util.js";
import { formatMoney } from "../order.js";
import { decodeJws, verifyJws, verifySdJwt, splitSdJwt } from "../jws.js";
import type { Jwk } from "../keys.js";
import type { Check } from "../types.js";
import type { MandateContext, MandateOutcome } from "./index.js";

export interface VerifiableIntentMandate {
  type: "verifiable-intent";
  l1: string;
  l2: string;
  l3: string;
}

export interface ViConstraints {
  allowed_merchants?: string[];
  max_amount?: { amount: number; currency: string };
  line_items?: { sku: string; max_qty?: number }[];
}

export async function verifyVerifiableIntent(m: VerifiableIntentMandate, ctx: MandateContext): Promise<MandateOutcome> {
  const checks: Check[] = [];
  const fail = (detail: string, data?: Record<string, unknown>): MandateOutcome => {
    checks.push({ name: "mandate_valid", status: "fail", detail, data });
    return { info: { type: m.type, valid: false, summary: detail }, checks };
  };

  // ---- L1: issuer credential
  if (!ctx.issuers) return fail("No issuer key directory is configured, so layer 1 cannot be checked.");
  let l1Claims: Record<string, unknown>;
  let issuerJwk: Jwk | undefined;
  try {
    const kid = String(decodeJws(splitSdJwt(m.l1).jwt).header.kid ?? "");
    const issuerKey = await ctx.issuers.resolve(kid);
    if (!issuerKey) return fail(`Issuer key "${kid}" was not found in any issuer directory.`);
    issuerJwk = { ...issuerKey.jwk, kid };
    l1Claims = verifySdJwt(m.l1, issuerKey.key).claims;
  } catch (e) {
    return fail(`Layer 1 (issuer credential) failed: ${(e as Error).message}`);
  }
  if (typeof l1Claims.exp === "number" && l1Claims.exp < ctx.now) return fail("Layer 1 (issuer credential) has expired.");
  const userJwk = (l1Claims.cnf as { jwk?: Jwk } | undefined)?.jwk;
  if (!userJwk) return fail("Layer 1 does not bind a user key (cnf.jwk).");

  // ---- L2: user mandate
  let l2Claims: Record<string, unknown>;
  try {
    l2Claims = verifySdJwt(m.l2, userJwk).claims;
  } catch (e) {
    return fail(`Layer 2 (user mandate) failed: ${(e as Error).message}`);
  }
  if (l2Claims.prev !== sha256B64url(m.l1)) return fail("Layer 2 is not linked to layer 1 (prev hash mismatch).");
  if (typeof l2Claims.exp === "number" && l2Claims.exp < ctx.now) return fail("Layer 2 (user mandate) has expired.");
  const mode = String(l2Claims.mode ?? "immediate");
  const constraints = (l2Claims.constraints ?? {}) as ViConstraints;

  // ---- L3: agent presentation to the merchant
  const l3Key = mode === "autonomous" ? (l2Claims.cnf as { jwk?: Jwk } | undefined)?.jwk : userJwk;
  if (!l3Key) return fail("Autonomous mandate does not bind an agent key (cnf.jwk) in layer 2.");
  let l3: Record<string, unknown>;
  try {
    l3 = verifyJws<Record<string, unknown>>(m.l3, l3Key).payload;
  } catch (e) {
    return fail(`Layer 3 (agent presentation) failed: ${(e as Error).message}`);
  }
  if (l3.prev !== sha256B64url(m.l2)) return fail("Layer 3 is not linked to layer 2 (prev hash mismatch).");
  if (typeof l3.exp === "number" && l3.exp < ctx.now) return fail("Layer 3 (agent presentation) has expired.");

  checks.push({
    name: "mandate_valid",
    status: "pass",
    detail: `Credential chain verified: issuer, user mandate (${mode}) and agent presentation.`,
    data: { mode, l2_expires: l2Claims.exp, l3_expires: l3.exp },
  });

  // ---- bind to the order
  const problems: string[] = [];
  if (l3.transaction_id !== ctx.orderHash) problems.push("the presented checkout does not match this order (transaction_id differs from the order hash)");
  if (constraints.allowed_merchants && !constraints.allowed_merchants.includes(ctx.merchantId))
    problems.push(`merchant ${ctx.merchantId} is not in the allowed merchants`);
  if (constraints.max_amount) {
    if (constraints.max_amount.currency.toLowerCase() !== ctx.order.currency.toLowerCase())
      problems.push(`currency ${ctx.order.currency} differs from the mandate's ${constraints.max_amount.currency}`);
    else if (ctx.order.total > constraints.max_amount.amount)
      problems.push(`order total ${ctx.order.total} exceeds the mandate cap ${constraints.max_amount.amount}`);
  }
  if (constraints.line_items) {
    for (const item of ctx.order.items) {
      const rule = constraints.line_items.find((r) => r.sku === item.sku);
      if (!rule) problems.push(`item ${item.sku} is not allowed by the mandate`);
      else if (rule.max_qty !== undefined && item.qty > rule.max_qty) problems.push(`item ${item.sku} quantity ${item.qty} exceeds ${rule.max_qty}`);
    }
  }
  checks.push(
    problems.length
      ? { name: "order_within_mandate", status: "fail", detail: "Order is outside the mandate: " + problems.join("; ") + ".", data: { problems } }
      : { name: "order_within_mandate", status: "pass", detail: "Order matches the presented checkout and every mandate constraint." },
  );

  return {
    issuerKeyJwk: issuerJwk,
    info: {
      type: m.type,
      mode,
      valid: true,
      constraintsOk: problems.length === 0,
      expiresAt: typeof l2Claims.exp === "number" ? new Date(l2Claims.exp * 1000).toISOString() : undefined,
      summary: describeConstraints(constraints),
    },
    checks,
  };
}

export function describeConstraints(c: ViConstraints): string {
  const parts: string[] = [];
  if (c.max_amount) parts.push(`up to ${formatMoney(c.max_amount.amount, c.max_amount.currency)}`);
  if (c.allowed_merchants) parts.push(`at ${c.allowed_merchants.join(", ")}`);
  if (c.line_items) parts.push(`items ${c.line_items.map((i) => i.sku + (i.max_qty ? " x" + i.max_qty : "")).join(", ")}`);
  return parts.join(", ") || "no constraints";
}
