/**
 * Test helpers: create agents, issuers and users, and sign requests and mandates the way real
 * agents do. Used by the test suite, the conformance vectors and the local playground.
 * Never use generated keys in production.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { signRequest, type AgentTag, type HttpRequestLike } from "./httpsig.js";
import { issueSdJwt, signJws } from "./jws.js";
import { publicJwk, type Jwk } from "./keys.js";
import { signBodyObject } from "./bodyObjects.js";
import { orderHash } from "./order.js";
import { sha256B64url } from "./util.js";
import type { Order } from "./types.js";
import type { ViConstraints, VerifiableIntentMandate } from "./mandates/verifiableIntent.js";
import type { Ap2CartMandate, Ap2IntentMandate } from "./mandates/ap2.js";

export interface KeyPair {
  kid: string;
  privateJwk: Jwk;
  publicJwk: Jwk;
}

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Ed25519 key pair. Pass a seed string for deterministic keys (test vectors). */
export function generateKey(kid: string, seed?: string): KeyPair {
  let priv;
  if (seed) {
    const s = createHash("sha256").update(seed).digest();
    priv = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, s]), format: "der", type: "pkcs8" });
  } else {
    priv = generateKeyPairSync("ed25519").privateKey;
  }
  const privateJwk = { ...(priv.export({ format: "jwk" }) as Jwk), kid, alg: "EdDSA" };
  const pub = { ...(createPublicKey(priv).export({ format: "jwk" }) as Jwk), kid, alg: "EdDSA", use: "sig" };
  return { kid, privateJwk, publicJwk: publicJwk(pub) };
}

export interface TestAgent extends KeyPair {
  name: string;
  sign(req: HttpRequestLike, o?: { tag?: AgentTag; nonce?: string; created?: number; expires?: number; components?: string[] }): HttpRequestLike;
}

export function createAgent(name: string, seed?: string): TestAgent {
  const kp = generateKey(`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${seed ? "k1" : randomBytes(3).toString("hex")}`, seed);
  return {
    ...kp,
    name,
    sign(req, o = {}) {
      return signRequest(req, {
        privateJwk: kp.privateJwk,
        keyid: kp.kid,
        tag: o.tag ?? "agent-payer-auth",
        nonce: o.nonce ?? randomBytes(16).toString("base64url"),
        created: o.created,
        expires: o.expires,
        components: o.components,
      });
    },
  };
}

/** Build a JSON checkout request body carrying the order, mandate and payment token. */
export function checkoutRequest(origin: string, body: Record<string, unknown>, path = "/checkout"): HttpRequestLike {
  const json = JSON.stringify(body);
  const url = new URL(path, origin);
  return { method: "POST", url: url.toString(), headers: { host: url.host, "content-type": "application/json" }, body: json };
}

let saltCounter = 0;
const salt = (seed?: string) => (n: string) => (seed ? sha256B64url(seed + n).slice(0, 16) : randomBytes(12).toString("base64url") + ++saltCounter);

/** Verifiable Intent style three-layer chain for an order. */
export function buildVerifiableIntent(o: {
  issuer: KeyPair;
  user: KeyPair;
  agent: KeyPair;
  order: Order;
  constraints: ViConstraints;
  mode?: "immediate" | "autonomous";
  now?: number;
  seed?: string;
  /** Override what the agent presents (for negative tests). */
  presentedTransactionId?: string;
}): VerifiableIntentMandate {
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const mode = o.mode ?? "autonomous";
  const l1 = issueSdJwt(
    { iss: "https://issuer.example", sub: "cardholder-123", iat: now, exp: now + 365 * 86400, cnf: { jwk: o.user.publicJwk }, card_last4: "4242" },
    ["sub", "card_last4"],
    o.issuer.privateJwk,
    salt(o.seed && o.seed + "l1"),
  );
  const l2 = issueSdJwt(
    {
      iat: now,
      exp: now + (mode === "autonomous" ? 7 * 86400 : 900),
      mode,
      prev: sha256B64url(l1),
      constraints: o.constraints,
      ...(mode === "autonomous" ? { cnf: { jwk: o.agent.publicJwk } } : {}),
      prompt_playback: "Buy the items in my saved list when they are in stock",
    },
    ["prompt_playback"],
    o.user.privateJwk,
    salt(o.seed && o.seed + "l2"),
  );
  const l3 = signJws(
    {
      iat: now,
      exp: now + 300,
      prev: sha256B64url(l2),
      merchant: o.order.merchant_id,
      transaction_id: o.presentedTransactionId ?? orderHash(o.order),
      total: { amount: o.order.total, currency: o.order.currency },
      line_items: o.order.items.map((i) => ({ sku: i.sku, qty: i.qty })),
    },
    mode === "autonomous" ? o.agent.privateJwk : o.user.privateJwk,
  );
  return { type: "verifiable-intent", l1, l2, l3 };
}

export function buildAp2Cart(o: { merchant: KeyPair; user: KeyPair; order: Order; expiresInSeconds?: number }): Ap2CartMandate {
  const cart = {
    cart_id: o.order.id ?? "cart_1",
    merchant_id: o.order.merchant_id,
    currency: o.order.currency,
    total: o.order.total,
    items: o.order.items.map((i) => ({ sku: i.sku, qty: i.qty, unit_amount: i.unit_amount })),
    expires_at: new Date(Date.now() + (o.expiresInSeconds ?? 900) * 1000).toISOString(),
  };
  return { type: "ap2-cart", merchant_signature: signJws(cart, o.merchant.privateJwk), user_signature: signJws(cart, o.user.privateJwk), user_jwk: o.user.publicJwk };
}

export function buildAp2Intent(o: { user: KeyPair; merchants?: string[]; maxAmount: number; currency: string; expiresInSeconds?: number }): Ap2IntentMandate {
  const intent = {
    merchants: o.merchants,
    max_amount: { amount: o.maxAmount, currency: o.currency },
    expires_at: new Date(Date.now() + (o.expiresInSeconds ?? 86400) * 1000).toISOString(),
    prompt_playback: "Reorder coffee beans when I run low, up to the limit",
  };
  return { type: "ap2-intent", jws: signJws(intent, o.user.privateJwk), user_jwk: o.user.publicJwk };
}

export { signBodyObject };
