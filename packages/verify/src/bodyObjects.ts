/**
 * Visa TAP body objects: the Agentic Consumer Recognition Object and the Agentic Payment Container.
 * Each carries `nonce`, `kid`, `alg` and `signature`, signed with the same key as the HTTP signature,
 * and repeats the header nonce so it is bound to that request.
 *
 * ASSUMPTION: Visa's specification does not yet define the exact signature base for these objects
 * (github.com/visa/trusted-agent-protocol/issues/23). Until it does, we sign and verify the RFC 8785
 * canonical JSON of the object without its `signature` member. This is isolated here so it can change
 * in one place when Visa publishes a worked example.
 */
import { createPrivateKey, type KeyObject } from "node:crypto";
import { canonicalize } from "./util.js";
import { signBytes, verifyBytes, type SigAlg } from "./httpsig.js";
import type { Jwk } from "./keys.js";
import type { Check } from "./types.js";

export interface SignedBodyObject {
  nonce: string;
  kid: string;
  alg: string;
  signature: string; // base64
  [k: string]: unknown;
}

function signingInput(obj: Record<string, unknown>): Buffer {
  const { signature: _omit, ...rest } = obj;
  return Buffer.from(canonicalize(rest), "utf8");
}

export function signBodyObject(obj: Omit<SignedBodyObject, "signature">, privateJwk: Jwk, alg: SigAlg = "ed25519"): SignedBodyObject {
  const pk = createPrivateKey({ key: privateJwk as never, format: "jwk" });
  const sig = signBytes(alg, pk, signingInput(obj as Record<string, unknown>));
  return { ...obj, signature: sig.toString("base64") } as SignedBodyObject;
}

export function verifyBodyObject(
  name: string,
  obj: SignedBodyObject | undefined,
  expect: { nonce: string; keyid: string; alg: SigAlg; key: KeyObject },
): Check | null {
  if (!obj) return null;
  const problems: string[] = [];
  if (obj.nonce !== expect.nonce) problems.push("its nonce does not match the signature nonce");
  if (obj.kid !== expect.keyid) problems.push("its kid does not match the signature keyid");
  let ok = false;
  try {
    ok = verifyBytes(expect.alg, expect.key, signingInput(obj), Buffer.from(obj.signature, "base64"));
  } catch {
    ok = false;
  }
  if (!ok) problems.push("its signature does not verify");
  return problems.length
    ? { name: `body_${name}`, status: "fail", detail: `The ${label(name)} is not bound to this request: ${problems.join("; ")}.` }
    : { name: `body_${name}`, status: "pass", detail: `The ${label(name)} is signed by the same agent key and bound to this request's nonce.` };
}

function label(name: string): string {
  return name === "consumer_recognition" ? "consumer recognition object" : name === "payment_container" ? "payment container" : name;
}
