import { createPublicKey, KeyObject } from "node:crypto";
import { canonicalize, sha256Hex } from "./util.js";

export interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  [k: string]: unknown;
}

export interface Jwks {
  keys: Jwk[];
}

export interface ResolvedKey {
  kid: string;
  jwk: Jwk;
  key: KeyObject;
  /** Directory the key came from, e.g. "visa" or "demo". */
  source: string;
  /** SHA-256 of the canonical public JWK. Stored with evidence so the key can be re-checked after rotation. */
  snapshotSha256: string;
}

export interface DirectorySource {
  /** Short name stored with evidence, e.g. "visa", "mastercard", "demo". */
  name: string;
  /** Inline key set (tests, self-hosted directories, pinned keys). */
  jwks?: Jwks;
  /** Remote JWKS URL, fetched and cached. */
  url?: string;
}

export interface KeyDirectoryOptions {
  sources: DirectorySource[];
  /** Cache lifetime for remote key sets. Default 10 minutes. */
  ttlMs?: number;
  /** Custom fetch (tests, proxies). Defaults to global fetch. */
  fetch?: typeof fetch;
}

/** Public JWK fields only; private members are stripped before hashing or storing. */
export function publicJwk(jwk: Jwk): Jwk {
  const allowed = ["kty", "kid", "alg", "use", "crv", "x", "y", "n", "e"];
  const out: Jwk = { kty: jwk.kty };
  for (const k of allowed) if (jwk[k] !== undefined) (out as Record<string, unknown>)[k] = jwk[k];
  return out;
}

export function jwkSnapshot(jwk: Jwk): string {
  return sha256Hex(canonicalize(publicJwk(jwk)));
}

export function importJwk(jwk: Jwk): KeyObject {
  return createPublicKey({ key: publicJwk(jwk) as never, format: "jwk" });
}

/**
 * Resolves agent public keys by keyid from one or more directories.
 * Remote directories are cached; every resolved key carries a snapshot hash for evidence.
 */
export class KeyDirectory {
  private readonly sources: DirectorySource[];
  private readonly ttlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, { at: number; jwks: Jwks }>();

  constructor(opts: KeyDirectoryOptions) {
    this.sources = opts.sources;
    this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  get sourceNames(): string[] {
    return this.sources.map((s) => s.name);
  }

  private async load(src: DirectorySource): Promise<Jwks> {
    if (src.jwks) return src.jwks;
    if (!src.url) return { keys: [] };
    const hit = this.cache.get(src.url);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.jwks;
    const res = await this.fetchImpl(src.url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Key directory ${src.name} returned HTTP ${res.status}`);
    const jwks = (await res.json()) as Jwks;
    if (!jwks || !Array.isArray(jwks.keys)) throw new Error(`Key directory ${src.name} did not return a JWKS`);
    this.cache.set(src.url, { at: Date.now(), jwks });
    return jwks;
  }

  /** Find a key by keyid. Optionally restrict to named directories. */
  async resolve(kid: string, only?: string[]): Promise<ResolvedKey | null> {
    for (const src of this.sources) {
      if (only && only.length && !only.includes(src.name)) continue;
      let jwks: Jwks;
      try {
        jwks = await this.load(src);
      } catch {
        continue; // an unreachable directory must not break the others
      }
      const jwk = jwks.keys.find((k) => k.kid === kid);
      if (jwk) {
        return { kid, jwk: publicJwk(jwk), key: importJwk(jwk), source: src.name, snapshotSha256: jwkSnapshot(jwk) };
      }
    }
    return null;
  }
}

/** Known public directories. Mastercard's directory URL is not public yet; add it when published. */
export const KNOWN_DIRECTORIES: Record<string, string> = {
  visa: "https://mcp.visa.com/.well-known/jwks",
};
