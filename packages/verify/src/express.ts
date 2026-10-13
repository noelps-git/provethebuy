/**
 * Express (and Connect-style) middleware.
 *
 *   app.post("/checkout", ptb.capture(), ptb.verify(), handler)
 *
 * capture() must run before any body parser so the raw bytes are kept exactly as signed.
 * In shadow mode nothing is ever blocked; the decision is attached to req.provethebuy.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { lowerKeys } from "./util.js";
import { contextFromBody, type CheckoutContext, type ProveTheBuy } from "./verify.js";
import type { EvidenceLedger, VerificationRecord } from "./ledger.js";
import type { HttpRequestLike } from "./httpsig.js";
import type { VerificationResult } from "./types.js";

type Next = (err?: unknown) => void;

export interface PtbRequest extends IncomingMessage {
  rawBody?: string;
  body?: unknown;
  originalUrl?: string;
  protocol?: string;
  provethebuy?: VerificationResult & { request: HttpRequestLike; context: CheckoutContext };
}

type Res = ServerResponse & { status?: (c: number) => Res; json?: (b: unknown) => void };

export interface MiddlewareOptions {
  /** Public base URL if you sit behind a proxy, e.g. https://shop.example */
  publicOrigin?: string;
  /** Maximum body size in bytes. Default 1 MB. */
  limit?: number;
}

function send(res: Res, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export function createMiddleware(verifier: ProveTheBuy, ledger?: EvidenceLedger, opts: MiddlewareOptions = {}) {
  const limit = opts.limit ?? 1_000_000;

  /** Read the raw body once and keep it. Also sets req.body for JSON requests. */
  const capture = () => (req: PtbRequest, res: Res, next: Next) => {
    if (req.rawBody !== undefined) return next();
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        send(res, 413, { error: "Request body too large" });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      req.rawBody = Buffer.concat(chunks).toString("utf8");
      if (String(req.headers["content-type"] ?? "").includes("json") && req.rawBody) {
        try {
          req.body = JSON.parse(req.rawBody);
        } catch {
          return send(res, 400, { error: "Body is not valid JSON" });
        }
      }
      next();
    });
    req.on("error", next);
  };

  const toRequest = (req: PtbRequest): HttpRequestLike => {
    const headers = lowerKeys(req.headers as Record<string, string | string[] | undefined>);
    const origin = opts.publicOrigin ?? `${req.protocol ?? "http"}://${headers["host"] ?? "localhost"}`;
    return { method: req.method ?? "GET", url: origin + (req.originalUrl ?? req.url ?? "/"), headers, body: req.rawBody };
  };

  /** Verify the request and apply the decision (enforce mode only). */
  const verify = () => async (req: PtbRequest, res: Res, next: Next) => {
    try {
      const request = toRequest(req);
      const context = contextFromBody(request.body);
      const result = await verifier.verify(request, context);
      req.provethebuy = { ...result, request, context };
      if (result.enforced && result.decision === "block") return send(res, 403, { error: "agent_request_blocked", reasons: result.reasons });
      if (result.enforced && result.decision === "step_up") return send(res, 409, { error: "confirmation_required", step_up: result.stepUp, reasons: result.reasons });
      next();
    } catch (e) {
      next(e);
    }
  };

  /** Write the evidence record. Call after you have charged, so the payment id is included. */
  const record = (req: PtbRequest, extra: { orderId?: string; paymentIntent?: string } = {}): VerificationRecord | undefined => {
    if (!ledger || !req.provethebuy) return undefined;
    const r = req.provethebuy;
    if (r.decision === "not_agent") return undefined;
    return ledger.record(r, { request: r.request, context: r.context, ...extra });
  };

  return { capture, verify, record };
}
