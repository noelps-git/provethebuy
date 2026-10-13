import { createHash } from "node:crypto";

/** base64url without padding */
export function b64url(input: Buffer | Uint8Array | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buf.toString("base64url");
}

export function fromB64url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function sha256(input: Buffer | string): Buffer {
  return createHash("sha256").update(input).digest();
}

export function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function sha256B64url(input: Buffer | string): string {
  return sha256(input).toString("base64url");
}

/**
 * JSON Canonicalization Scheme (RFC 8785).
 * Object keys are sorted by UTF-16 code units; numbers use ECMAScript serialisation,
 * which is what JSON.stringify produces for finite numbers.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("JCS: non-finite numbers are not allowed");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalize(v === undefined ? null : v)).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
  }
  throw new TypeError(`JCS: unsupported type ${typeof value}`);
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function lowerKeys(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

export function randomId(prefix: string): string {
  const rnd = createHash("sha256").update(String(Math.random()) + Date.now() + process.hrtime.bigint()).digest("base64url");
  return `${prefix}_${rnd.slice(0, 22)}`;
}
