/**
 * Accountable Agents Framework (AAF) agent IDs.
 *
 * Under AAF, a directory verifies the person or organisation behind an agent (the principal) and
 * issues the agent pseudonymous IDs. A merchant can check an ID offline with the directory's public
 * key, learn nothing about the principal by default, and report an incident back to the directory
 * if something goes wrong.
 *
 * ProveTheBuy reads an ID presented in the request body as:
 *
 *   "agent_id": { "type": "aaf", "presentation": "<SD-JWT>" }
 *
 * The SD-JWT is signed by a directory key and carries:
 *   sub              the ID itself (pairwise or single-use; opaque to the merchant)
 *   aud              optional: the merchant id the ID was issued for
 *   exp              expiry
 *   cnf.jwk          the agent's own public key. It must be the key that signed the HTTP request,
 *                    otherwise the ID was lifted from another agent (AAF property PR-2).
 *   assurance        optional, selectively disclosed: how the principal was verified (e.g. "IAL2")
 *   spending_limit   optional, selectively disclosed: { amount, currency } in minor units
 *
 * STATUS: preview. AAF is a framework rather than a wire format. This follows the batch-issued
 * SD-JWT VC option in Appendix C of the AAF paper and will track the reference implementation.
 */
import { decodeJws, splitSdJwt, verifySdJwt } from "./jws.js";
import type { KeyDirectory, Jwk } from "./keys.js";
import type { Check, Money } from "./types.js";

export interface AgentIdPresentation {
  type: "aaf";
  presentation: string;
}

export interface AgentIdInfo {
  framework: "aaf";
  /** Directory that issued the ID (name of the key directory source). */
  directory: string;
  /** The ID as presented. Opaque: it does not reveal the principal. */
  id: string;
  assurance?: string;
  spendingLimit?: Money;
  expiresAt?: string;
}

export interface AgentIdContext {
  directories?: KeyDirectory;
  /** Directory names to trust. Empty = all configured. */
  trusted?: string[];
  /** The public key that signed the HTTP request. */
  agentJwk: Jwk;
  merchantId: string;
  now: number;
  /** Optional revocation lookup, e.g. a status list fetched from the directory. */
  isRevoked?: (id: string, directory: string) => boolean | Promise<boolean>;
}

export interface AgentIdOutcome {
  ok: boolean;
  checks: Check[];
  info?: AgentIdInfo;
}

/** Two JWKs describe the same public key. */
export function sameKey(a: Jwk | undefined, b: Jwk | undefined): boolean {
  if (!a || !b) return false;
  return a.kty === b.kty && a.crv === b.crv && a.x === b.x && (a.y ?? null) === (b.y ?? null) && (a.n ?? null) === (b.n ?? null);
}

export async function verifyAgentId(p: AgentIdPresentation | undefined, ctx: AgentIdContext): Promise<AgentIdOutcome | null> {
  if (!p) return null;
  const checks: Check[] = [];
  const fail = (detail: string): AgentIdOutcome => {
    checks.push({ name: "agent_id_valid", status: "fail", detail });
    return { ok: false, checks };
  };
  if (p.type !== "aaf" || typeof p.presentation !== "string") return fail("Agent ID is not an AAF presentation.");
  if (!ctx.directories) return fail("No agent ID directory is configured, so the agent ID cannot be checked.");

  let claims: Record<string, unknown>;
  let directory: string;
  try {
    const kid = String(decodeJws(splitSdJwt(p.presentation).jwt).header.kid ?? "");
    const key = await ctx.directories.resolve(kid, ctx.trusted?.length ? ctx.trusted : undefined);
    if (!key) return fail(`Agent ID was signed by "${kid}", which is not in any trusted ID directory.`);
    directory = key.source;
    claims = verifySdJwt(p.presentation, key.key).claims;
  } catch (e) {
    return fail(`Agent ID does not verify: ${(e as Error).message}.`);
  }

  const id = String(claims.sub ?? "");
  if (!id) return fail("Agent ID has no identifier (sub).");
  if (typeof claims.exp === "number" && claims.exp < ctx.now) return fail("Agent ID has expired.");
  if (claims.aud !== undefined) {
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(ctx.merchantId)) return fail(`Agent ID was issued for ${aud.join(", ")}, not for this merchant.`);
  }
  checks.push({ name: "agent_id_valid", status: "pass", detail: `Agent ID verified with the signing key of ${directory}.`, data: { id, directory } });

  const cnf = (claims.cnf as { jwk?: Jwk } | undefined)?.jwk;
  if (!sameKey(cnf, ctx.agentJwk)) {
    checks.push({
      name: "agent_id_bound",
      status: "fail",
      detail: "The agent ID belongs to a different key from the one that signed this request, so it was taken from another agent.",
    });
    return { ok: false, checks };
  }
  checks.push({ name: "agent_id_bound", status: "pass", detail: "The agent ID is bound to the key that signed this request." });

  if (ctx.isRevoked && (await ctx.isRevoked(id, directory))) {
    checks.push({ name: "agent_id_status", status: "fail", detail: "The directory has revoked this agent ID." });
    return { ok: false, checks };
  }
  if (ctx.isRevoked) checks.push({ name: "agent_id_status", status: "pass", detail: "The directory has not revoked this agent ID." });

  const limit = claims.spending_limit as Money | undefined;
  const info: AgentIdInfo = {
    framework: "aaf",
    directory,
    id,
    assurance: typeof claims.assurance === "string" ? claims.assurance : undefined,
    spendingLimit: limit && typeof limit.amount === "number" && typeof limit.currency === "string" ? { amount: limit.amount, currency: limit.currency } : undefined,
    expiresAt: typeof claims.exp === "number" ? new Date(claims.exp * 1000).toISOString() : undefined,
  };
  return { ok: true, checks, info };
}
