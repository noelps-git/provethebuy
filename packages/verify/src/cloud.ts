/**
 * Send evidence records to ProveTheBuy Cloud in the background.
 *
 *   const cloud = connectCloud(ledger, { apiKey: process.env.PROVETHEBUY_API_KEY });
 *
 * Fails open by design: a slow or unreachable cloud never delays or breaks checkout. Records wait in a
 * bounded in-memory queue and are retried; if the queue fills, the oldest are dropped and counted.
 * On serverless platforms, call `await cloud.flush()` before the response ends.
 */
import type { EvidenceLedger, LedgerRecord } from "./ledger.js";

export interface CloudOptions {
  apiKey: string;
  /** Default https://api.provethebuy.dev */
  endpoint?: string;
  /** Records per request. Default 50. */
  batchSize?: number;
  /** How often queued records are sent, in ms. Default 2000. */
  flushIntervalMs?: number;
  /** Per-request timeout in ms. Default 3000. */
  timeoutMs?: number;
  /** Most records held while the cloud is unreachable. Default 5000. */
  maxQueue?: number;
  /** Send the raw request and key snapshot so the cloud can re-verify for disputes. Default true. */
  includeArtifacts?: boolean;
  fetch?: typeof fetch;
  onError?: (err: Error) => void;
}

export interface CloudStats {
  queued: number;
  sent: number;
  dropped: number;
  failures: number;
  lastError?: string;
}

export interface CloudConnection {
  /** Send everything queued now. Never throws. */
  flush(): Promise<void>;
  /** Stop the timer and send what is left. */
  close(): Promise<void>;
  readonly stats: CloudStats;
}

export function connectCloud(ledger: EvidenceLedger, opts: CloudOptions): CloudConnection {
  if (!opts?.apiKey) throw new Error("connectCloud needs an apiKey (PROVETHEBUY_API_KEY).");
  const endpoint = (opts.endpoint ?? "https://api.provethebuy.dev").replace(/\/$/, "");
  const batchSize = opts.batchSize ?? 50;
  const maxQueue = opts.maxQueue ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const doFetch = opts.fetch ?? fetch;
  const queue: LedgerRecord[] = [];
  const stats: CloudStats = { queued: 0, sent: 0, dropped: 0, failures: 0 };
  let inFlight: Promise<void> | null = null;
  let backoffUntil = 0;

  const unsubscribe = ledger.onRecord((rec) => {
    const r = opts.includeArtifacts === false && rec.type === "verification" ? { ...rec, artifacts: undefined } : rec;
    queue.push(r);
    while (queue.length > maxQueue) {
      queue.shift();
      stats.dropped++;
    }
    stats.queued = queue.length;
    if (queue.length >= batchSize) void flush();
  });

  async function sendBatch(batch: LedgerRecord[]): Promise<boolean> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${endpoint}/v1/records`, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ records: batch }),
        signal: ctrl.signal,
      });
      if (res.status === 401 || res.status === 403) throw new Error(`ProveTheBuy Cloud rejected the API key (HTTP ${res.status}).`);
      if (res.status === 400) {
        // A malformed batch will never succeed: drop it rather than retry forever.
        stats.dropped += batch.length;
        throw new Error(`ProveTheBuy Cloud refused a batch (HTTP 400): ${(await res.text()).slice(0, 200)}`);
      }
      if (!res.ok) throw Object.assign(new Error(`ProveTheBuy Cloud returned HTTP ${res.status}.`), { retry: true });
      stats.sent += batch.length;
      return true;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      stats.failures++;
      stats.lastError = err.message;
      try {
        opts.onError?.(err);
      } catch {
        /* ignore */
      }
      const retry = (err as { retry?: boolean }).retry || err.name === "AbortError" || err.name === "TypeError";
      return !retry; // true = do not requeue
    } finally {
      clearTimeout(t);
    }
  }

  async function drain(): Promise<void> {
    while (queue.length && Date.now() >= backoffUntil) {
      const batch = queue.splice(0, batchSize);
      const done = await sendBatch(batch);
      if (!done) {
        queue.unshift(...batch);
        while (queue.length > maxQueue) {
          queue.pop();
          stats.dropped++;
        }
        backoffUntil = Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(stats.failures, 6));
        break;
      }
    }
    stats.queued = queue.length;
  }

  function flush(): Promise<void> {
    if (!inFlight) inFlight = drain().finally(() => (inFlight = null));
    return inFlight;
  }

  const timer = setInterval(() => void flush(), opts.flushIntervalMs ?? 2000);
  (timer as { unref?: () => void }).unref?.();

  return {
    flush: async () => {
      backoffUntil = 0;
      await flush();
    },
    close: async () => {
      clearInterval(timer);
      unsubscribe();
      backoffUntil = 0;
      await flush();
    },
    get stats() {
      return { ...stats, queued: queue.length };
    },
  };
}
