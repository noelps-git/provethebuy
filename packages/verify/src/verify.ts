/**
 * The verifier: one call per incoming request.
 *
 *   1. Is this an agent?          Signature-Input / Signature headers present
 *   2. Is the agent who it says?  window, nonce, tag, key directory, RFC 9421 signature, body objects
 *   3. Was it allowed to buy?     mandate chain (Verifiable Intent, AP2) and scoped token limits
 *   4. Is this the order it was allowed to buy?  order hash and constraints
 *   5. Decide                     allow / step_up / block, applied only in enforce mode
 */
import { sha256Hex, nowSeconds } from "./util.js";
import { KeyDirectory, type Jwk } from "./keys.js";
import { MemoryReplayStore, type ReplayStore } from "./replay.js";
import {
  AGENT_TAGS,
  inferAlg,
  parseSignatureHeader,
  parseSignatureInput,
  signatureBase,
  verifyBytes,
  type HttpRequestLike,
  type ParsedSignature,
} from "./httpsig.js";
import { verifyBodyObject, type SignedBodyObject } from "./bodyObjects.js";
import { verifyMandate, type Mandate } from "./mandates/index.js";
import { checkPaymentLimits, type PaymentCredential } from "./payment.js";
import { itemsTotal, orderHash } from "./order.js";
import { resolvePolicy, type Policy, type PolicyInput } from "./policy.js";
import type { AgentInfo, Check, Decision, MandateInfo, Order, VerificationResult } from "./types.js";

export interface CheckoutContext {
  order?: Order;
  mandate?: Mandate;
  payment?: PaymentCredential;
  consumerRecognition?: SignedBodyObject;
  paymentContainer?: SignedBodyObject;
}

export interface AgentStats {
  orders: number;
  disputes: number;
  mismatches: number;
}

export type ReputationProvider = (keyid: string) => AgentStats | undefined | Promise<AgentStats | undefined>;

export interface ProveTheBuyOptions {
  /** Your merchant id, as it appears in mandates and payment tokens. */
  merchantId: string;
  /** Where agent keys come from. */
  keys: KeyDirectory;
  /** Issuer keys for Verifiable Intent layer 1. */
  issuers?: KeyDirectory;
  /** Shared nonce store. Defaults to in-memory (single server only). */
  replay?: ReplayStore;
  policy?: PolicyInput;
  /** Your own public key, to check your signature on AP2 cart mandates. */
  merchantJwk?: Jwk;
  reputation?: ReputationProvider;
  /** Clock override for tests. */
  now?: () => number;
}

/** Pull checkout context out of a JSON body: { order, mandate, payment, consumer_recognition, payment_container }. */
export function contextFromBody(body: string | undefined): CheckoutContext {
  if (!body) return {};
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    return {
      order: j.order as Order | undefined,
      mandate: j.mandate as Mandate | undefined,
      payment: j.payment as PaymentCredential | undefined,
      consumerRecognition: (j.consumer_recognition ?? j.agenticConsumer) as SignedBodyObject | undefined,
      paymentContainer: (j.payment_container ?? j.agenticPaymentContainer) as SignedBodyObject | undefined,
    };
  } catch {
    return {};
  }
}

function protocolFor(directory: string | undefined): AgentInfo["protocol"] {
  if (directory === "visa") return "visa-tap";
  if (directory === "mastercard") return "mastercard-agent-pay";
  return "web-bot-auth";
}

export class ProveTheBuy {
  readonly policy: Policy;
  private readonly replay: ReplayStore;
  private readonly now: () => number;

  constructor(private readonly opts: ProveTheBuyOptions) {
    this.policy = resolvePolicy(opts.policy);
    this.replay = opts.replay ?? new MemoryReplayStore();
    this.now = opts.now ?? nowSeconds;
  }

  /** Return a copy of this verifier with a different policy (used for dry runs). */
  withPolicy(policy: PolicyInput): ProveTheBuy {
    return new ProveTheBuy({ ...this.opts, policy, replay: new MemoryReplayStore() });
  }

  async verify(req: HttpRequestLike, ctxIn?: CheckoutContext): Promise<VerificationResult> {
    const receivedAt = new Date(this.now() * 1000).toISOString();
    try {
      return await this.run(req, ctxIn ?? contextFromBody(req.body), receivedAt);
    } catch (e) {
      const open = this.policy.fail === "open";
      return {
        decision: open ? "not_agent" : "block",
        enforced: this.policy.mode === "enforce",
        reasons: [`Verification error (${open ? "failing open" : "failing closed"}): ${(e as Error).message}`],
        checks: [{ name: "internal_error", status: "warn", detail: (e as Error).message }],
        policyVersion: this.policy.version!,
        receivedAt,
      };
    }
  }

  private async run(req: HttpRequestLike, ctx: CheckoutContext, receivedAt: string): Promise<VerificationResult> {
    const p = this.policy;
    const now = this.now();
    const checks: Check[] = [];
    const reasons: string[] = [];
    const headers = req.headers;
    const rawSha256 = sha256Hex(
      `${req.method.toUpperCase()} ${req.url}\n` + Object.keys(headers).sort().map((k) => `${k}: ${headers[k]}`).join("\n") + "\n\n" + (req.body ?? ""),
    );
    const base = { enforced: p.mode === "enforce", policyVersion: p.version!, receivedAt, rawSha256 };
    let keyForRecord: VerificationResult["agentKeyJwk"];
    let issuerForRecord: VerificationResult["issuerKeyJwk"];
    const done = (decision: Decision, extra: Partial<VerificationResult> = {}): VerificationResult => ({ decision, reasons, checks, ...base, agentKeyJwk: keyForRecord, issuerKeyJwk: issuerForRecord, ...extra });

    // ---------------------------------------------------------------- 1. agent?
    const sigInput = headers["signature-input"];
    const sigHeader = headers["signature"];
    if (!sigInput || !sigHeader) {
      checks.push({ name: "signature_present", status: "skip", detail: "No agent signature headers. Left to your existing fraud tools." });
      reasons.push("Not a signed agent request.");
      return done("not_agent");
    }
    checks.push({ name: "signature_present", status: "pass", detail: "Signature-Input and Signature headers are present." });

    let parsed: ParsedSignature;
    let sigBytes: Buffer;
    try {
      const inputs = parseSignatureInput(sigInput);
      const sigs = parseSignatureHeader(sigHeader);
      const chosen = inputs.find((i) => AGENT_TAGS.includes(String(i.params.tag) as never)) ?? inputs[0];
      if (!chosen || !sigs[chosen.label]) throw new Error("no Signature value matches the Signature-Input label");
      parsed = chosen;
      sigBytes = sigs[chosen.label];
    } catch (e) {
      checks.push({ name: "signature_parse", status: "fail", detail: `Signature headers could not be parsed: ${(e as Error).message}.` });
      reasons.push("Malformed agent signature.");
      return done("block");
    }
    const sp = parsed.params;
    const agent: AgentInfo = {
      protocol: "web-bot-auth",
      keyid: String(sp.keyid ?? ""),
      tag: sp.tag as string,
      alg: sp.alg as string,
      nonce: sp.nonce as string,
      created: sp.created as number,
      expires: sp.expires as number,
    };

    // params complete
    const missing = ["created", "expires", "keyid", "nonce", "tag"].filter((k) => sp[k] === undefined);
    if (missing.length) {
      checks.push({ name: "params_complete", status: "fail", detail: `Signature is missing required parameters: ${missing.join(", ")}.` });
      reasons.push("Incomplete agent signature.");
      return done("block", { agent });
    }
    checks.push({ name: "params_complete", status: "pass", detail: "created, expires, keyid, nonce and tag are all present." });

    // tag
    const tag = String(sp.tag);
    if (!AGENT_TAGS.includes(tag as never)) {
      checks.push({ name: "tag_valid", status: "fail", detail: `Tag "${tag}" is not agent-browser-auth or agent-payer-auth.` });
      reasons.push("Unknown agent tag.");
      return done("block", { agent });
    }
    checks.push({ name: "tag_valid", status: "pass", detail: tag === "agent-payer-auth" ? "Agent declares it is paying (agent-payer-auth)." : "Agent declares it is browsing (agent-browser-auth)." });

    // window
    const created = Number(sp.created);
    const expires = Number(sp.expires);
    const skew = p.agents.clock_skew_seconds;
    const windowProblems: string[] = [];
    if (expires <= created) windowProblems.push("expires is not after created");
    if (expires - created > p.agents.max_window_seconds) windowProblems.push(`window of ${expires - created}s exceeds ${p.agents.max_window_seconds}s`);
    if (created > now + skew) windowProblems.push("created is in the future");
    if (expires < now - skew) windowProblems.push(`signature expired ${now - expires}s ago`);
    if (windowProblems.length) {
      checks.push({ name: "window", status: "fail", detail: "Signature time window is invalid: " + windowProblems.join("; ") + ".", data: { created, expires, now } });
      reasons.push("Expired or invalid signature window.");
      return done("block", { agent });
    }
    checks.push({ name: "window", status: "pass", detail: `Signed ${Math.max(0, now - created)}s ago, valid for ${expires - created}s.`, data: { created, expires } });

    // key
    const key = await this.opts.keys.resolve(agent.keyid, p.agents.directories.length ? p.agents.directories : undefined);
    if (!key) {
      checks.push({ name: "key_found", status: "fail", detail: `Key "${agent.keyid}" is not in any trusted directory (${this.opts.keys.sourceNames.join(", ") || "none configured"}).` });
      reasons.push("Unknown agent key.");
      return done("block", { agent });
    }
    agent.directory = key.source;
    agent.protocol = protocolFor(key.source);
    agent.keySnapshotSha256 = key.snapshotSha256;
    keyForRecord = key.jwk;
    checks.push({ name: "key_found", status: "pass", detail: `Key found in the ${key.source} directory.`, data: { snapshot: key.snapshotSha256 } });

    // signature
    const alg = inferAlg(key.jwk, sp.alg as string | undefined);
    if (!alg) {
      checks.push({ name: "signature_valid", status: "fail", detail: `Unsupported signature algorithm "${String(sp.alg)}".` });
      reasons.push("Unsupported algorithm.");
      return done("block", { agent });
    }
    let sigOk = false;
    let baseStr = "";
    try {
      baseStr = signatureBase(req, parsed);
      sigOk = verifyBytes(alg, key.key, Buffer.from(baseStr, "utf8"), sigBytes);
    } catch (e) {
      checks.push({ name: "signature_valid", status: "fail", detail: `Signature base could not be built: ${(e as Error).message}.` });
      reasons.push("Signature could not be checked.");
      return done("block", { agent });
    }
    if (!sigOk) {
      checks.push({ name: "signature_valid", status: "fail", detail: "Signature does not match. The request was altered, or signed with a different key.", data: { signature_base: baseStr } });
      reasons.push("Invalid agent signature.");
      return done("block", { agent });
    }
    checks.push({ name: "signature_valid", status: "pass", detail: `${alg} signature verified over ${parsed.components.join(", ")}.`, data: { signature_base: baseStr } });

    // nonce: only after the signature is valid, so forged requests cannot burn nonces
    const fresh = await this.replay.checkAndRemember(`${agent.keyid}:${agent.nonce}`, expires - now + skew);
    if (!fresh) {
      checks.push({ name: "nonce_unused", status: "fail", detail: "This nonce was already used. The request is a replay." });
      reasons.push("Replayed request.");
      return done("block", { agent });
    }
    checks.push({ name: "nonce_unused", status: "pass", detail: "Nonce has not been seen before." });

    // body objects
    for (const [name, obj] of [["consumer_recognition", ctx.consumerRecognition], ["payment_container", ctx.paymentContainer]] as const) {
      const c = verifyBodyObject(name, obj, { nonce: agent.nonce!, keyid: agent.keyid, alg, key: key.key });
      if (c) {
        checks.push(c);
        if (c.status === "fail") {
          reasons.push("Signed body object is not bound to this request.");
          return done("block", { agent });
        }
      }
    }

    // browsing agents stop here
    if (tag === "agent-browser-auth" && !ctx.order) {
      reasons.push("Verified browsing agent.");
      return done("allow", { agent });
    }

    // ---------------------------------------------------------------- 3-4. mandate and order
    const order = ctx.order;
    const state: { decision: Decision } = { decision: "allow" };
    let mandateInfo: MandateInfo | undefined;
    let oh: string | undefined;
    const escalate = (to: Decision, why: string) => {
      reasons.push(why);
      const rank: Record<Decision, number> = { not_agent: 0, allow: 1, step_up: 2, block: 3 };
      if (rank[to] > rank[state.decision]) state.decision = to;
    };

    if (!order) {
      checks.push({ name: "order_present", status: "warn", detail: "Paying agent request has no order in the body, so it cannot be bound to a mandate." });
      escalate(p.mandate.on_missing === "allow" ? "allow" : p.mandate.on_missing, "No order to bind.");
    } else {
      oh = orderHash(order);
      const sumOk = itemsTotal(order) === order.total;
      checks.push(
        sumOk
          ? { name: "order_consistent", status: "pass", detail: "Order total equals the sum of its items.", data: { order_hash: oh } }
          : { name: "order_consistent", status: "fail", detail: `Order total ${order.total} does not equal the items sum ${itemsTotal(order)}.`, data: { order_hash: oh } },
      );
      if (!sumOk) escalate("block", "Inconsistent order.");
      if (p.limits.require_merchant_match && order.merchant_id !== this.opts.merchantId) {
        checks.push({ name: "merchant_match", status: "fail", detail: `Order is for merchant ${order.merchant_id}, not ${this.opts.merchantId}.` });
        escalate("block", "Order for a different merchant.");
      }

      const m = await verifyMandate(ctx.mandate, {
        order,
        orderHash: oh,
        now,
        merchantId: this.opts.merchantId,
        issuers: this.opts.issuers,
        merchantJwk: this.opts.merchantJwk,
        accept: p.mandate.accept,
      });
      if (!m) {
        checks.push({ name: "mandate_present", status: "fail", detail: "No mandate: nothing shows what the person allowed the agent to buy." });
        if (p.mandate.on_missing !== "allow") escalate(p.mandate.on_missing, "No mandate from the person.");
      } else {
        checks.push({ name: "mandate_present", status: "pass", detail: `Mandate type ${m.info.type}.` });
        checks.push(...m.checks);
        mandateInfo = m.info;
        issuerForRecord = m.issuerKeyJwk;
        if (!m.info.valid) escalate("block", "Mandate does not verify.");
        else if (m.info.constraintsOk === false) escalate(p.mandate.on_outside, "Order is outside the mandate.");
        const intentOnly = m.info.type === "ap2-intent" || m.info.mode === "autonomous";
        if (m.info.valid && intentOnly && p.limits.intent_mandate_max_order > 0 && order.total > p.limits.intent_mandate_max_order) {
          checks.push({ name: "intent_threshold", status: "warn", detail: `Unattended purchase of ${order.total} is above the ${p.limits.intent_mandate_max_order} confirmation threshold.` });
          escalate("step_up", "Large unattended purchase.");
        }
      }

      const t = checkPaymentLimits(ctx.payment, order, this.opts.merchantId, now);
      checks.push(t);
      if (t.status === "fail") escalate("block", "Payment token limits would be exceeded.");
    }

    // ---------------------------------------------------------------- reputation
    if (this.opts.reputation) {
      const s = await this.opts.reputation(agent.keyid);
      if (s && s.orders >= p.reputation.min_orders_for_reputation) {
        const rate = s.disputes / s.orders;
        const bad = rate > p.reputation.step_up_if_agent_dispute_rate_over;
        checks.push({
          name: "reputation",
          status: bad ? "warn" : "pass",
          detail: `This agent key: ${s.orders} orders, ${(rate * 100).toFixed(1)}% disputed.`,
          data: { ...s, rate },
        });
        if (bad) escalate("step_up", "Agent has a high dispute rate.");
      } else {
        checks.push({ name: "reputation", status: "skip", detail: "Not enough history for this agent key yet." });
      }
    }

    const final: Decision = state.decision;
    if (final === "allow" && !reasons.length) reasons.push("Verified agent, valid mandate, order inside its limits.");
    return done(final, {
      agent,
      mandate: mandateInfo,
      orderHash: oh,
      stepUp:
        final === "step_up"
          ? { reason: reasons[reasons.length - 1], suggested: ctx.mandate?.type === "ap2-intent" || !ctx.mandate ? "ap2-cart-mandate" : "confirm-in-session" }
          : undefined,
    });
  }
}
