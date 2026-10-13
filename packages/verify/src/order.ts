import { canonicalize, sha256B64url } from "./util.js";
import type { Order } from "./types.js";

/**
 * One stable hash per order: canonical JSON (RFC 8785) of the fields that define what was bought.
 * The same order always gives the same hash, whatever key order or whitespace it arrived in.
 */
export function orderHash(order: Order): string {
  const core = {
    merchant_id: order.merchant_id,
    currency: order.currency.toLowerCase(),
    total: order.total,
    items: order.items
      .map((i) => ({ sku: i.sku, qty: i.qty, unit_amount: i.unit_amount }))
      .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)),
  };
  return sha256B64url(canonicalize(core));
}

/** Sum of line items, for catching orders whose total does not match their items. */
export function itemsTotal(order: Order): number {
  return order.items.reduce((s, i) => s + i.qty * i.unit_amount, 0);
}

export function formatMoney(amount: number, currency: string): string {
  const cur = currency.toUpperCase();
  const zeroDecimal = ["JPY", "KRW", "VND"].includes(cur);
  const v = zeroDecimal ? amount : amount / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(v);
  } catch {
    return `${v.toFixed(zeroDecimal ? 0 : 2)} ${cur}`;
  }
}
