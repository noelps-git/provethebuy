/** Compact JWS and SD-JWT helpers (EdDSA, ES256, PS256). */
import { createPrivateKey, KeyObject } from "node:crypto";
import { b64url, fromB64url, sha256B64url } from "./util.js";
import { importJwk, type Jwk } from "./keys.js";
import { signBytes, verifyBytes, type SigAlg } from "./httpsig.js";

const JOSE_TO_ALG: Record<string, SigAlg> = { EdDSA: "ed25519", ES256: "ecdsa-p256-sha256", PS256: "ps256" };

export interface JwsResult<T = Record<string, unknown>> {
  header: Record<string, unknown>;
  payload: T;
}

export function joseAlgFor(jwk: Jwk): string {
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") return "EdDSA";
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ES256";
  if (jwk.kty === "RSA") return "PS256";
  throw new Error(`Unsupported key type ${jwk.kty}`);
}

export function signJws(payload: unknown, privateJwk: Jwk, extraHeader: Record<string, unknown> = {}): string {
  const alg = joseAlgFor(privateJwk);
  const header = { alg, typ: "JWT", ...(privateJwk.kid ? { kid: privateJwk.kid } : {}), ...extraHeader };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const pk = createPrivateKey({ key: privateJwk as never, format: "jwk" });
  const sig = signBytes(JOSE_TO_ALG[alg], pk, Buffer.from(input));
  return `${input}.${b64url(sig)}`;
}

export function decodeJws<T = Record<string, unknown>>(jws: string): JwsResult<T> {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("JWS must have three parts");
  return { header: JSON.parse(fromB64url(parts[0]).toString()), payload: JSON.parse(fromB64url(parts[1]).toString()) };
}

export function verifyJws<T = Record<string, unknown>>(jws: string, key: Jwk | KeyObject): JwsResult<T> {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("JWS must have three parts");
  const header = JSON.parse(fromB64url(parts[0]).toString()) as Record<string, unknown>;
  const alg = JOSE_TO_ALG[String(header.alg)];
  if (!alg) throw new Error(`Unsupported JWS alg ${String(header.alg)}`);
  const keyObj = key instanceof KeyObject ? key : importJwk(key);
  const ok = verifyBytes(alg, keyObj, Buffer.from(`${parts[0]}.${parts[1]}`), fromB64url(parts[2]));
  if (!ok) throw new Error("JWS signature does not verify");
  return { header, payload: JSON.parse(fromB64url(parts[1]).toString()) as T };
}

// ---------------------------------------------------------------- SD-JWT

export interface SdJwtParts {
  jwt: string;
  disclosures: string[];
}

export function splitSdJwt(sdjwt: string): SdJwtParts {
  const parts = sdjwt.split("~");
  return { jwt: parts[0], disclosures: parts.slice(1).filter(Boolean) };
}

/** Create a disclosure for one claim: base64url(JSON [salt, name, value]). */
export function makeDisclosure(name: string, value: unknown, salt: string): string {
  return b64url(JSON.stringify([salt, name, value]));
}

export function disclosureDigest(disclosure: string): string {
  return sha256B64url(Buffer.from(disclosure, "ascii"));
}

/**
 * Issue an SD-JWT: the listed claims are moved behind disclosures and replaced by their digests in _sd.
 */
export function issueSdJwt(claims: Record<string, unknown>, selective: string[], privateJwk: Jwk, saltFn: (n: string) => string): string {
  const payload: Record<string, unknown> = { _sd_alg: "sha-256" };
  const disclosures: string[] = [];
  const sd: string[] = [];
  for (const [k, v] of Object.entries(claims)) {
    if (selective.includes(k)) {
      const d = makeDisclosure(k, v, saltFn(k));
      disclosures.push(d);
      sd.push(disclosureDigest(d));
    } else payload[k] = v;
  }
  if (sd.length) payload._sd = sd.sort();
  return [signJws(payload, privateJwk, { typ: "sd+jwt" }), ...disclosures].join("~") + "~";
}

/** Verify issuer signature and reveal disclosed claims. Rejects disclosures not committed in _sd. */
export function verifySdJwt(sdjwt: string, key: Jwk | KeyObject): { header: Record<string, unknown>; claims: Record<string, unknown> } {
  const { jwt, disclosures } = splitSdJwt(sdjwt);
  const { header, payload } = verifyJws<Record<string, unknown>>(jwt, key);
  const committed = new Set<string>(Array.isArray(payload._sd) ? (payload._sd as string[]) : []);
  const claims: Record<string, unknown> = { ...payload };
  delete claims._sd;
  delete claims._sd_alg;
  for (const d of disclosures) {
    if (!committed.has(disclosureDigest(d))) throw new Error("Disclosure is not committed in the signed _sd list");
    const arr = JSON.parse(fromB64url(d).toString()) as unknown[];
    if (!Array.isArray(arr) || arr.length !== 3) throw new Error("Malformed disclosure");
    claims[String(arr[1])] = arr[2];
  }
  return { header, claims };
}
