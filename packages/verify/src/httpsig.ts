/**
 * HTTP Message Signatures (RFC 9421) as used by Web Bot Auth, Visa Trusted Agent Protocol
 * and Mastercard Agent Pay.
 */
import { createPrivateKey, KeyObject, sign as nodeSign, verify as nodeVerify, constants } from "node:crypto";
import type { Jwk } from "./keys.js";

export interface HttpRequestLike {
  method: string;
  /** Absolute URL, e.g. https://shop.example/checkout?x=1 */
  url: string;
  headers: Record<string, string>;
  /** Raw body exactly as received. */
  body?: string;
}

export interface SignatureParams {
  created?: number;
  expires?: number;
  keyid?: string;
  alg?: string;
  nonce?: string;
  tag?: string;
  [k: string]: string | number | boolean | undefined;
}

export interface ParsedSignature {
  label: string;
  components: string[];
  params: SignatureParams;
  /** Serialised inner list + parameters, used verbatim as @signature-params. */
  paramsRaw: string;
  signature?: Buffer;
}

export const AGENT_TAGS = ["agent-browser-auth", "agent-payer-auth"] as const;
export type AgentTag = (typeof AGENT_TAGS)[number];

/** Split a structured-field dictionary on top-level commas (respecting quotes, parens, colons). */
function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let inBytes = false;
  let cur = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      cur += ch;
      if (ch === "\\" && i + 1 < input.length) {
        cur += input[++i];
        continue;
      }
      if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') inQuote = true;
    else if (ch === ":" && depth === 0) inBytes = !inBytes;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0 && !inBytes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseParamValue(raw: string): string | number | boolean {
  const v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v === "?1") return true;
  if (v === "?0") return false;
  return v;
}

/** Parse Signature-Input into labelled members. */
export function parseSignatureInput(header: string): ParsedSignature[] {
  const members = splitTopLevel(header, ",");
  const out: ParsedSignature[] = [];
  for (const m of members) {
    const eq = m.indexOf("=");
    if (eq < 1) throw new Error("Malformed Signature-Input member");
    const label = m.slice(0, eq).trim();
    const value = m.slice(eq + 1).trim();
    if (!value.startsWith("(")) throw new Error("Signature-Input must start with an inner list");
    const close = value.indexOf(")");
    if (close < 0) throw new Error("Unterminated inner list in Signature-Input");
    const inner = value.slice(1, close).trim();
    const components = inner ? (inner.match(/"[^"]*"/g) ?? []).map((c) => c.slice(1, -1)) : [];
    const params: SignatureParams = {};
    const rest = value.slice(close + 1);
    for (const p of splitTopLevel(rest, ";")) {
      if (!p) continue;
      const i = p.indexOf("=");
      if (i < 0) params[p.trim()] = true;
      else params[p.slice(0, i).trim()] = parseParamValue(p.slice(i + 1));
    }
    out.push({ label, components, params, paramsRaw: value });
  }
  return out;
}

/** Parse Signature header: label=:base64: */
export function parseSignatureHeader(header: string): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const m of splitTopLevel(header, ",")) {
    const eq = m.indexOf("=");
    if (eq < 1) continue;
    const label = m.slice(0, eq).trim();
    const v = m.slice(eq + 1).trim();
    if (!v.startsWith(":") || !v.endsWith(":")) throw new Error("Signature value must be a byte sequence");
    out[label] = Buffer.from(v.slice(1, -1), "base64");
  }
  return out;
}

/** Resolve the value of one covered component. */
export function componentValue(req: HttpRequestLike, component: string): string {
  const url = new URL(req.url);
  switch (component) {
    case "@method":
      return req.method.toUpperCase();
    case "@authority":
      return (req.headers["host"] ?? url.host).toLowerCase();
    case "@path":
      return url.pathname || "/";
    case "@query":
      return url.search || "?";
    case "@target-uri":
      return url.toString();
    case "@scheme":
      return url.protocol.replace(":", "");
    case "@request-target":
      return (url.pathname || "/") + url.search;
    default: {
      if (component.startsWith("@")) throw new Error(`Unsupported derived component ${component}`);
      const v = req.headers[component.toLowerCase()];
      if (v === undefined) throw new Error(`Covered header "${component}" is missing from the request`);
      return v.trim().replace(/\s*\r?\n\s*/g, " ");
    }
  }
}

/** Build the exact signature base string (RFC 9421 section 2.5). */
export function signatureBase(req: HttpRequestLike, sig: Pick<ParsedSignature, "components" | "paramsRaw">): string {
  const lines = sig.components.map((c) => `"${c}": ${componentValue(req, c)}`);
  lines.push(`"@signature-params": ${sig.paramsRaw}`);
  return lines.join("\n");
}

export type SigAlg = "ed25519" | "rsa-pss-sha512" | "rsa-pss-sha256" | "ps256" | "ecdsa-p256-sha256";

export function inferAlg(jwk: Jwk, declared?: string): SigAlg | null {
  const d = (declared ?? jwk.alg ?? "").toString().toLowerCase();
  if (d === "ed25519" || d === "eddsa") return "ed25519";
  if (d === "rsa-pss-sha512" || d === "ps512") return "rsa-pss-sha512";
  if (d === "rsa-pss-sha256" || d === "ps256") return "ps256";
  if (d === "ecdsa-p256-sha256" || d === "es256") return "ecdsa-p256-sha256";
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") return "ed25519";
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ecdsa-p256-sha256";
  if (jwk.kty === "RSA") return "ps256";
  return null;
}

export function verifyBytes(alg: SigAlg, key: KeyObject, data: Buffer, signature: Buffer): boolean {
  switch (alg) {
    case "ed25519":
      return nodeVerify(null, data, key, signature);
    case "rsa-pss-sha512":
      return nodeVerify("sha512", data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 64 }, signature);
    case "rsa-pss-sha256":
    case "ps256":
      return nodeVerify("sha256", data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, signature);
    case "ecdsa-p256-sha256":
      return nodeVerify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, signature);
  }
}

export function signBytes(alg: SigAlg, privateKey: KeyObject, data: Buffer): Buffer {
  switch (alg) {
    case "ed25519":
      return nodeSign(null, data, privateKey);
    case "rsa-pss-sha512":
      return nodeSign("sha512", data, { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 64 });
    case "rsa-pss-sha256":
    case "ps256":
      return nodeSign("sha256", data, { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
    case "ecdsa-p256-sha256":
      return nodeSign("sha256", data, { key: privateKey, dsaEncoding: "ieee-p1363" });
  }
}

export interface SignRequestOptions {
  privateJwk: Jwk;
  keyid: string;
  alg?: SigAlg;
  tag: AgentTag;
  components?: string[];
  created?: number;
  expires?: number;
  nonce: string;
  label?: string;
}

/** Sign a request the way an agent would. Used by tests, the playground and conformance vectors. */
export function signRequest(req: HttpRequestLike, o: SignRequestOptions): HttpRequestLike {
  const alg = o.alg ?? "ed25519";
  const components = o.components ?? ["@authority", "@path"];
  const created = o.created ?? Math.floor(Date.now() / 1000);
  const expires = o.expires ?? created + 480;
  const label = o.label ?? "sig1";
  const inner = "(" + components.map((c) => `"${c}"`).join(" ") + ")";
  const paramsRaw = `${inner};created=${created};expires=${expires};keyid="${o.keyid}";alg="${alg}";nonce="${o.nonce}";tag="${o.tag}"`;
  const base = signatureBase(req, { components, paramsRaw });
  const pk = createPrivateKey({ key: o.privateJwk as never, format: "jwk" });
  const sig = signBytes(alg, pk, Buffer.from(base, "utf8"));
  return {
    ...req,
    headers: {
      ...req.headers,
      "signature-input": `${label}=${paramsRaw}`,
      signature: `${label}=:${sig.toString("base64")}:`,
    },
  };
}
