/**
 * Verify a shopper confirmation issued by ProveTheBuy Cloud's hosted confirmation page.
 *
 *   const c = await verifyConfirmation(token, { jwksUrl: "https://app.provethebuy.dev/.well-known/jwks.json", orderHash });
 *   if (c.status === "approved") { ...charge... }
 */
import { createPublicKey, verify } from "node:crypto";
import type { Jwks } from "./keys.js";

export interface ConfirmationClaims {
  sub: string;
  status: "approved" | "declined";
  order_hash: string;
  store: string;
  decided_at: string;
  iat: number;
  iss: string;
}

export async function verifyConfirmation(
  token: string,
  opts: { jwks?: Jwks; jwksUrl?: string; orderHash?: string; maxAgeSeconds?: number; fetch?: typeof fetch },
): Promise<ConfirmationClaims> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new Error("Not a confirmation token.");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  if (header.alg !== "EdDSA") throw new Error("Unexpected token algorithm.");
  const jwks = opts.jwks ?? ((await (await (opts.fetch ?? fetch)(opts.jwksUrl!)).json()) as Jwks);
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error(`Signing key ${header.kid} is not in the JWKS.`);
  const ok = verify(null, Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk as any, format: "jwk" }), Buffer.from(s, "base64url"));
  if (!ok) throw new Error("Confirmation signature does not verify.");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as ConfirmationClaims & { typ?: string };
  if (claims.typ !== "provethebuy-confirmation") throw new Error("Token is not a ProveTheBuy confirmation.");
  if (opts.orderHash && claims.order_hash !== opts.orderHash) throw new Error("Confirmation is for a different order.");
  if (opts.maxAgeSeconds && Date.now() / 1000 - claims.iat > opts.maxAgeSeconds) throw new Error("Confirmation is too old.");
  return claims;
}
