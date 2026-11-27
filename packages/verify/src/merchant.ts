/**
 * Signed checkout for real stores (Feature 4: anti-triangulation).
 *
 * A merchant publishes a key at /.well-known/provethebuy.json on its domain.
 * It signs every cart it sends to an agent. A fake store can copy product photos
 * but it cannot sign as the real domain. The agent calls verifyMerchant() before paying.
 *
 * verifyMerchant() is free, open source, and takes three lines:
 *
 *   import { verifyMerchant } from "@provethebuy/verify";
 *   const result = await verifyMerchant(signedCart, "nike.com");
 *   if (!result.valid) throw new Error("Fake store");
 */
import { verifyJws, signJws } from "./jws.js";
import type { Jwk } from "./keys.js";
import type { Check } from "./types.js";

export interface SignedCart {
  /** Compact JWS over the cart, signed by the merchant's private key. */
  jws: string;
}

export interface MerchantKeySet {
  keys: Jwk[];
  domain: string;
  updated_at: string;
}

export interface MerchantVerifyResult {
  valid: boolean;
  domain: string;
  cart: Record<string, unknown>;
  checks: Check[];
}

export interface VerifyMerchantOptions {
  /** Override the default fetch (for testing or server-side use). */
  fetch?: typeof globalThis.fetch;
  /** Pre-loaded merchant key set (skips the .well-known fetch). */
  keySet?: MerchantKeySet;
}

/**
 * Verify that a signed cart was really issued by the merchant at `domain`.
 * Used by shopping agents to check they are buying from a real store.
 */
export async function verifyMerchant(
  cart: SignedCart,
  domain: string,
  opts: VerifyMerchantOptions = {},
): Promise<MerchantVerifyResult> {
  const checks: Check[] = [];
  const fail = (detail: string): MerchantVerifyResult => ({
    valid: false,
    domain,
    cart: {},
    checks: [...checks, { name: "merchant_verify", status: "fail", detail }],
  });

  // 1. Get the merchant's published key set
  let keySet: MerchantKeySet;
  if (opts.keySet) {
    keySet = opts.keySet;
    checks.push({ name: "merchant_key_found", status: "pass", detail: "Merchant key set provided directly." });
  } else {
    const fetchFn = opts.fetch ?? globalThis.fetch;
    const url = `https://${domain}/.well-known/provethebuy.json`;
    try {
      const res = await fetchFn(url);
      if (!res.ok) return fail(`Could not fetch merchant keys from ${url}: HTTP ${res.status}.`);
      keySet = (await res.json()) as MerchantKeySet;
    } catch (e) {
      return fail(`Could not fetch merchant keys from ${url}: ${(e as Error).message}.`);
    }
    checks.push({ name: "merchant_key_found", status: "pass", detail: `Fetched merchant key set from ${url}.` });
  }

  if (!keySet.keys?.length) return fail("Merchant key set has no keys.");

  // 2. Verify the JWS signature against one of the merchant's keys
  let payload: Record<string, unknown> | undefined;
  let sigOk = false;
  for (const key of keySet.keys) {
    try {
      const result = verifyJws<Record<string, unknown>>(cart.jws, key);
      payload = result.payload;
      sigOk = true;
      break;
    } catch {
      // Try the next key
    }
  }

  if (!sigOk || !payload) {
    checks.push({ name: "merchant_signature_valid", status: "fail", detail: "Cart signature does not match any of the merchant's published keys." });
    return { valid: false, domain, cart: {}, checks };
  }
  checks.push({ name: "merchant_signature_valid", status: "pass", detail: "Cart signature verified against the merchant's published key." });

  // 3. Check the cart's merchant_id matches the domain
  const cartMerchant = String(payload.merchant_id ?? payload.merchant ?? "");
  if (cartMerchant && cartMerchant !== domain && !cartMerchant.endsWith(`.${domain}`)) {
    checks.push({ name: "merchant_domain_match", status: "fail", detail: `Cart merchant_id "${cartMerchant}" does not match domain "${domain}".` });
    return { valid: false, domain, cart: payload, checks };
  }
  checks.push({
    name: "merchant_domain_match",
    status: cartMerchant ? "pass" : "warn",
    detail: cartMerchant ? `Cart merchant_id "${cartMerchant}" matches domain.` : "Cart has no merchant_id field to check against the domain.",
  });

  return { valid: true, domain, cart: payload, checks };
}

/**
 * Sign a cart as a merchant. Returns a compact JWS string.
 * Used by merchants to sign their checkout carts before sending to agents.
 */
export function signCheckout(cart: Record<string, unknown>, privateJwk: Jwk): string {
  return signJws(cart, privateJwk);
}
