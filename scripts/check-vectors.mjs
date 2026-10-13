// Runs every vector in test-vectors/vectors.json through the verifier. Exit code 1 on any mismatch.
import { readFileSync } from "node:fs";
import { ProveTheBuy, KeyDirectory } from "@provethebuy/verify";

const b = JSON.parse(readFileSync(new URL("../test-vectors/vectors.json", import.meta.url), "utf8"));
const make = () =>
  new ProveTheBuy({
    merchantId: b.merchant_id,
    keys: new KeyDirectory({ sources: [{ name: "visa", jwks: b.directories.agents }] }),
    issuers: new KeyDirectory({ sources: [{ name: "issuers", jwks: b.directories.issuers }] }),
    merchantJwk: b.merchant_jwk,
    policy: { mode: "enforce" },
    now: () => b.now,
  });
let failed = 0;
for (const v of b.vectors) {
  const ptb = make();
  const runs = [[await ptb.verify(v.request), v.expect]];
  if (v.sendTwice) runs.push([await ptb.verify(v.request), v.expect.second]);
  for (const [res, exp] of runs) {
    const failOk = !exp.failed || res.checks.some((c) => c.name === exp.failed && c.status === "fail");
    const ok = res.decision === exp.decision && failOk;
    if (!ok) failed++;
    console.log(`${ok ? "✓" : "✗"} ${v.name.padEnd(28)} ${res.decision}${exp.failed ? " (" + exp.failed + ")" : ""}${ok ? "" : "  expected " + exp.decision}`);
  }
}
console.log(failed ? `\n${failed} vector(s) failed` : `\nAll ${b.vectors.length} vectors pass`);
process.exit(failed ? 1 : 0);
