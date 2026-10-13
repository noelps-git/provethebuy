// ProveTheBuy playground front end. No build step, no framework.
const view = document.getElementById("view");
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("on"), 2600);
}

const DECISION_LABEL = { allow: "Allow", step_up: "Step-up", block: "Block", not_agent: "Not an agent" };
const DISPUTE_LABEL = { opened: "Needs evidence", evidence_submitted: "Evidence submitted", won: "Won", lost: "Lost" };
const CHECK_LABEL = {
  signature_present: "Agent signature present",
  signature_parse: "Signature readable",
  params_complete: "Signature parameters",
  tag_valid: "Purpose tag",
  window: "Time window",
  key_found: "Key in directory",
  signature_valid: "Signature matches",
  nonce_unused: "Not a replay",
  body_consumer_recognition: "Consumer object bound",
  body_payment_container: "Payment container bound",
  order_present: "Order present",
  order_consistent: "Order adds up",
  merchant_match: "Right merchant",
  mandate_present: "Mandate present",
  mandate_valid: "Mandate verifies",
  mandate_user_key_trust: "User key trust",
  order_within_mandate: "Order inside mandate",
  intent_threshold: "Unattended amount",
  token_limits: "Payment token limits",
  reputation: "Agent reputation",
  internal_error: "Verifier error",
};
const STATUS_WORD = { pass: "Pass", fail: "Fail", warn: "Note", skip: "Skipped" };
const chip = (d, label) => `<span class="chip ${esc(d)}">${esc(label ?? DECISION_LABEL[d] ?? DISPUTE_LABEL[d] ?? d)}</span>`;
const time = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const money = (minor, cur = "usd") => new Intl.NumberFormat("en-US", { style: "currency", currency: cur.toUpperCase() }).format(minor / 100);

const ICON = {
  pass: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--allow-soft)"/><path d="M6 10.4l2.6 2.6L14 7.6" fill="none" stroke="var(--allow)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fail: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--block-soft)"/><path d="M7 7l6 6M13 7l-6 6" stroke="var(--block)" stroke-width="2" stroke-linecap="round"/></svg>',
  warn: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--step-soft)"/><path d="M10 5.5v6" stroke="var(--step)" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14.3" r="1.2" fill="var(--step)"/></svg>',
  skip: '<svg class="ic" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--neutral-soft)"/><path d="M6.5 10h7" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"/></svg>',
};

function checkLines(checks) {
  return `<ul class="lines">${checks
    .map(
      (c) => `<li class="${esc(c.status)}">${ICON[c.status] ?? ICON.skip}<div class="t"><strong>${esc(CHECK_LABEL[c.name] ?? c.name)}</strong><em>${esc(STATUS_WORD[c.status] ?? c.status)}</em></div><div class="d">${esc(c.detail)}</div></li>`,
    )
    .join("")}</ul>`;
}

function proofStrip(result, extra = {}) {
  const sigBase = result.checks.find((c) => c.data?.signature_base)?.data.signature_base;
  const a = result.agent;
  const meta = [
    a && ["Agent", `${esc(extra.agentName ?? a.keyid)} <span class="sub">(${esc(a.protocol)}, ${esc(a.tag)})</span>`],
    a?.directory && ["Directory", esc(a.directory)],
    result.mandate && ["Mandate", `${esc(result.mandate.type)}${result.mandate.mode ? " · " + esc(result.mandate.mode) : ""}`],
    result.orderHash && ["Order hash", `<code>${esc(result.orderHash)}</code>`],
    ["Policy", `${esc(result.policyVersion)}${result.enforced ? "" : " <span class=\"sub\">(shadow mode: decision recorded, not applied)</span>"}`],
  ].filter(Boolean);
  return `<div class="proof ${esc(result.decision)}">
    <div class="verdict"><b>${esc(DECISION_LABEL[result.decision])}</b><span>${esc(time(result.receivedAt))}</span></div>
    <p class="why">${esc(result.reasons.join(" "))}</p>
    <dl class="meta">${meta.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    ${checkLines(result.checks)}
    ${sigBase ? `<details class="more"><summary>Show the exact signature base that was checked</summary><pre class="block">${esc(sigBase)}</pre></details>` : ""}
    ${extra.recordId ? `<div class="proof-foot"><span>Saved to the evidence ledger as <code>${esc(extra.recordId)}</code></span><a href="#/requests/${esc(extra.recordId)}">Open in Requests</a></div>` : ""}
  </div>`;
}

// ------------------------------------------------------------------ rail
async function refreshRail() {
  try {
    const [s, l] = await Promise.all([api("/api/state"), api("/api/ledger/verify")]);
    $("#merchant").textContent = s.merchant;
    const mode = $("#mode");
    mode.textContent = s.mode === "enforce" ? "Enforcing decisions" : "Shadow mode: never blocks";
    mode.className = "mode " + s.mode;
    const led = $("#ledger");
    led.textContent = l.ok ? `Ledger intact, ${l.checked} records` : `Ledger broken at ${l.brokenAt}`;
    led.className = "ledger " + (l.ok ? "ok" : "bad");
    const n = $("#nav-disputes");
    n.hidden = !s.open_disputes;
    n.textContent = s.open_disputes;
  } catch {
    /* server restarting */
  }
}

// ------------------------------------------------------------------ playground
const pg = { scenarios: [], current: null, request: null };

async function renderPlayground() {
  if (!pg.scenarios.length) pg.scenarios = await api("/api/scenarios");
  const groups = [
    ["Should be allowed", "allow"],
    ["Should be blocked", "block"],
    ["Should ask the shopper to confirm", "step_up"],
  ];
  view.innerHTML = `
    <div class="page-head"><div><h1>Playground</h1><p>Pick a situation, or paste your own signed request. Every check runs through the real verifier, and each result is saved to the local evidence ledger.</p></div></div>
    <div class="pg">
      <div class="scenarios" role="group" aria-label="Scenarios">
        ${groups
          .map(([label, d]) => `<div class="group-label">${label}</div>${pg.scenarios.filter((s) => s.expect === d).map((s) => `<button type="button" data-id="${esc(s.id)}" aria-pressed="false"><span class="name">${esc(s.name)}</span></button>`).join("")}`)
          .join("")}
      </div>
      <div class="pg-work">
        <div>
          <p class="scenario-desc" id="scenario-desc">Choose a scenario on the left to load a signed request.</p>
          <div class="editor-head"><h2>Request</h2><div class="btn-row"><button class="btn" id="resign" type="button">Sign a fresh copy</button><button class="btn primary" id="run" type="button">Verify request</button></div></div>
          <textarea class="code" id="req" spellcheck="false" aria-label="Signed request as JSON" wrap="off" placeholder='{ "method": "POST", "url": "https://shop.example/checkout", "headers": { ... }, "body": "..." }'></textarea>
          <div class="field-error" id="req-error" hidden></div>
          <p class="sub">The request is plain JSON: method, url, headers and the raw body. Edit anything and verify again to see which check catches it.</p>
        </div>
        <div id="result"><div class="proof empty">The verification receipt appears here.</div></div>
      </div>
    </div>`;
  $$(".scenarios button").forEach((b) => b.addEventListener("click", () => loadScenario(b.dataset.id)));
  $("#run").addEventListener("click", runVerify);
  $("#resign").addEventListener("click", () => pg.current && loadScenario(pg.current, true));
  $("#req").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runVerify();
  });
  if (pg.request) {
    $("#req").value = JSON.stringify(pg.request, null, 2);
    markScenario(pg.current);
  } else loadScenario("valid-payer");
}

function markScenario(id) {
  $$(".scenarios button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === id)));
  const s = pg.scenarios.find((x) => x.id === id);
  if (s) $("#scenario-desc").textContent = s.description;
}

async function loadScenario(id, silent) {
  pg.current = id;
  markScenario(id);
  const { request, note } = await api(`/api/scenarios/${id}/build`, { method: "POST" });
  pg.request = request;
  $("#req").value = JSON.stringify(request, null, 2);
  $("#req-error").hidden = true;
  if (note) toast(note);
  else if (silent) toast("Signed a fresh copy with a new nonce.");
  if (id === "replay" && !note) toast("Verify this once, then press Verify again: the second attempt is a replay.");
}

async function runVerify() {
  const err = $("#req-error");
  let request;
  try {
    request = JSON.parse($("#req").value);
  } catch (e) {
    err.textContent = `The request is not valid JSON: ${e.message}`;
    err.hidden = false;
    return;
  }
  err.hidden = true;
  pg.request = request;
  const btn = $("#run");
  btn.disabled = true;
  try {
    const { result, record_id, agent_name } = await api("/api/verify", { method: "POST", body: JSON.stringify({ request }) });
    $("#result").innerHTML = proofStrip(result, { recordId: record_id, agentName: agent_name });
    refreshRail();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ agent traffic
const DCOL = { allow: "var(--allow)", step_up: "var(--step)", block: "var(--block)", not_agent: "var(--muted)" };

function hourlyChart(hourly) {
  const W = 720, H = 220, L = 32, B = 26, T = 8;
  const keys = ["allow", "step_up", "block"];
  const max = Math.max(4, ...hourly.map((h) => keys.reduce((s, k) => s + h[k], 0)));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const bw = (W - L) / hourly.length;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  let svg = "";
  for (let i = 0; i <= 4; i++) svg += `<line class="grid" x1="${L}" x2="${W}" y1="${y(i * step)}" y2="${y(i * step)}"/><text class="axis" x="${L - 6}" y="${y(i * step) + 4}" text-anchor="end">${i * step}</text>`;
  hourly.forEach((h, i) => {
    let acc = 0;
    const x = L + i * bw + 3;
    const w = Math.max(2, bw - 6);
    keys.forEach((k) => {
      if (!h[k]) return;
      const y1 = y(acc + h[k]);
      const y0 = y(acc);
      svg += `<rect x="${x}" y="${y1}" width="${w}" height="${Math.max(0, y0 - y1 - 2)}" rx="2" fill="${DCOL[k]}"/>`;
      acc += h[k];
    });
    svg += `<rect class="hit" data-i="${i}" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>`;
    if (i % 4 === 0) svg += `<text class="axis" x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${new Date(h.hour + ":00Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>`;
  });
  return `<div class="chart" id="hourly"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Agent requests per hour by decision">${svg}</svg><div class="tip" id="tip"></div></div>`;
}

function bindChartTips(hourly) {
  const c = $("#hourly");
  if (!c) return;
  const tip = $("#tip", c);
  $$(".hit", c).forEach((r) =>
    r.addEventListener("mousemove", (e) => {
      const h = hourly[+r.dataset.i];
      const box = c.getBoundingClientRect();
      tip.innerHTML = `${new Date(h.hour + ":00Z").toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}<br>Allow ${h.allow}, step-up ${h.step_up}, block ${h.block}`;
      tip.style.left = `${e.clientX - box.left}px`;
      tip.style.top = `${e.clientY - box.top}px`;
      tip.classList.add("on");
    }),
  );
  c.addEventListener("mouseleave", () => tip.classList.remove("on"));
}

function barList(rows) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return `<div class="bars">${rows.map(([k, v]) => `<div class="bar-row"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${(100 * v) / max}%"></div></div><span class="n">${v}</span></div>`).join("")}</div>`;
}

const PROTOCOL_LABEL = { "visa-tap": "Visa Trusted Agent Protocol", "mastercard-agent-pay": "Mastercard Agent Pay", "web-bot-auth": "Web Bot Auth", unknown: "Unidentified" };

async function renderTraffic() {
  const r = await api("/api/report");
  const t = r.totals;
  view.innerHTML = `
    <div class="page-head"><div><h1>Agent traffic</h1><p>What reached <code>${esc(r.merchant)}</code> in the last 24 hours, and what the verifier decided. In shadow mode nothing was blocked; these are the decisions it would have made.</p></div></div>
    <div class="stats">
      <div class="stat"><div class="v">${t.agent_requests}</div><div class="l">Agent requests</div></div>
      <div class="stat"><div class="v">${t.verified}</div><div class="l">Signature verified</div></div>
      <div class="stat"><div class="v">${t.step_ups}</div><div class="l">Would ask to confirm</div></div>
      <div class="stat"><div class="v">${t.blocked}</div><div class="l">Would block</div></div>
      <div class="stat"><div class="v">${money(t.checkout_value)}</div><div class="l">Allowed agent orders</div></div>
    </div>
    <div class="grid-2">
      <div class="panel"><h2>Requests per hour</h2>
        <div class="legend"><span><i style="background:var(--allow)"></i>Allow</span><span><i style="background:var(--step)"></i>Step-up</span><span><i style="background:var(--block)"></i>Block</span></div>
        ${hourlyChart(r.hourly)}
      </div>
      <div class="panel"><h2>By protocol</h2>${barList(Object.entries(r.by_protocol).map(([k, v]) => [PROTOCOL_LABEL[k] ?? k, v]).sort((a, b) => b[1] - a[1]))}
        <h2 style="margin-top:22px">Most common failures</h2>${r.by_failure.length ? barList(r.by_failure.slice(0, 6).map(([k, v]) => [CHECK_LABEL[k] ?? k, v])) : '<p class="sub">No failed checks.</p>'}
      </div>
    </div>
    <div class="panel"><h2>Check your own access log</h2>
      <p class="sub" style="margin-top:-6px">Drop a day of Nginx, Apache or JSON logs here. It is read on this machine and never uploaded anywhere else.</p>
      <div class="upload" id="drop"><input type="file" id="logfile" hidden><p>Drop a log file, <button class="link" id="pick" type="button">choose one</button>, or <button class="link" id="sample" type="button">use the sample log</button>.</p></div>
      <div id="log-result"></div>
    </div>`;
  bindChartTips(r.hourly);
  const drop = $("#drop");
  const run = async (text, name) => {
    const res = await api("/api/traffic-check", { method: "POST", body: text, headers: { "content-type": "text/plain" } });
    $("#log-result").innerHTML = `
      <div class="stats" style="margin:18px 0 14px">
        <div class="stat"><div class="v">${res.totalRequests.toLocaleString()}</div><div class="l">Requests in ${esc(name)}</div></div>
        <div class="stat"><div class="v">${res.agentRequests.toLocaleString()}</div><div class="l">From AI agents</div></div>
        <div class="stat"><div class="v">${res.checkoutHits.toLocaleString()}</div><div class="l">On checkout pages</div></div>
        <div class="stat"><div class="v">${res.signedRequests.toLocaleString()}</div><div class="l">Signed, can be verified</div></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Agent</th><th>Operator</th><th>Kind</th><th class="num">Requests</th><th class="num">Checkout</th></tr></thead><tbody>
      ${res.byAgent.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.operator)}</td><td>${a.kind === "crawler" ? "Crawler" : "Acts for a person"}</td><td class="num">${a.requests}</td><td class="num">${a.checkoutHits}</td></tr>`).join("") || '<tr><td colspan="5" class="empty-state">No AI agents found in this log.</td></tr>'}
      </tbody></table></div>
      <p class="sub">User-agent names can be faked. Only signed requests can be verified.</p>
      <div class="btn-row"><button class="btn" id="copy-share" type="button">Copy a shareable summary</button></div>`;
    $("#copy-share").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(res.share);
        toast("Summary copied.");
      } catch {
        toast(res.share);
      }
    });
  };
  $("#pick").addEventListener("click", () => $("#logfile").click());
  $("#logfile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (f) run(await f.text(), f.name);
  });
  $("#sample").addEventListener("click", async () => run(await api("/api/sample-log"), "the sample log"));
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    const f = e.dataTransfer.files[0];
    if (f) run(await f.text(), f.name);
  });
}

// ------------------------------------------------------------------ requests
let reqFilter = "all";

async function renderRequests(openId) {
  const list = await api(`/api/requests?decision=${reqFilter}`);
  view.innerHTML = `
    <div class="page-head"><div><h1>Requests</h1><p>Every agent request the verifier has seen, newest first. Open one to see each check, the raw headers and its place in the evidence ledger.</p></div></div>
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Filter by decision">${["all", "allow", "step_up", "block", "not_agent"].map((d) => `<button type="button" data-d="${d}" aria-pressed="${reqFilter === d}">${d === "all" ? "All" : DECISION_LABEL[d]}</button>`).join("")}</div>
      <span class="sub">${list.length} requests</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Time</th><th>Agent</th><th>Request</th><th>Decision</th><th class="num">Amount</th><th>Why</th></tr></thead>
      <tbody>${
        list
          .map(
            (r) =>
              `<tr class="clickable" data-id="${esc(r.record_id)}" tabindex="0"><td>${esc(time(r.received_at))}</td><td>${esc(r.agent ?? "Unsigned")}</td><td><code>${esc(r.method)} ${esc(r.path)}</code></td><td>${chip(r.decision)}</td><td class="num">${esc(r.amount_display ?? "")}</td><td><span class="reason">${esc(r.reason)}</span></td></tr>`,
          )
          .join("") || '<tr><td colspan="6" class="empty-state">No requests match this filter.</td></tr>'
      }</tbody></table></div>`;
  $$(".seg button").forEach((b) => b.addEventListener("click", () => {
    reqFilter = b.dataset.d;
    renderRequests();
  }));
  $$("tr.clickable").forEach((tr) => {
    tr.addEventListener("click", () => (location.hash = `#/requests/${tr.dataset.id}`));
    tr.addEventListener("keydown", (e) => e.key === "Enter" && (location.hash = `#/requests/${tr.dataset.id}`));
  });
  if (openId) openRecord(openId);
}

async function openRecord(id) {
  const rec = await api(`/api/requests/${id}`);
  const req = rec.artifacts?.request;
  const result = { decision: rec.decision, reasons: rec.reasons, checks: rec.checks, agent: rec.agent, mandate: rec.mandate, orderHash: rec.order?.order_hash, policyVersion: rec.policy_version, enforced: rec.enforced, receivedAt: rec.received_at };
  openDrawer(
    `${DECISION_LABEL[rec.decision]}: ${rec.request.method} ${rec.request.path}`,
    `${proofStrip(result, { agentName: rec.agent_name })}
     <h2 style="margin-top:24px">Raw request</h2>
     ${req ? `<pre class="block">${esc(`${req.method} ${req.url}\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\n"))}</pre>` : '<p class="sub">Not stored.</p>'}
     ${req?.body ? `<details class="more"><summary>Body (${req.body.length.toLocaleString()} bytes)</summary><pre class="block">${esc(prettyJson(req.body))}</pre></details>` : ""}
     <h2 style="margin-top:24px">Ledger entry</h2>
     <dl class="kv"><dt>Record</dt><dd><code>${esc(rec.record_id)}</code></dd><dt>Hash</dt><dd><code>${esc(rec.hash)}</code></dd><dt>Previous hash</dt><dd><code>${esc(rec.prev_hash)}</code></dd>${rec.order?.payment_intent ? `<dt>Payment</dt><dd><code>${esc(rec.order.payment_intent)}</code></dd>` : ""}</dl>`,
  );
}

function prettyJson(s) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function openDrawer(title, html) {
  const d = document.getElementById("drawer");
  $("#drawer-title").textContent = title;
  $("#drawer-body").innerHTML = html;
  d.hidden = false;
  d.dataset.prevFocus = "";
  $(".drawer-panel .icon").focus();
}
function closeDrawer() {
  const d = document.getElementById("drawer");
  if (d.hidden) return;
  d.hidden = true;
  if (location.hash.split("/").length > 2) history.replaceState(null, "", "#/" + location.hash.split("/")[1]);
}
document.addEventListener("click", (e) => e.target.closest("[data-close]") && closeDrawer());
document.addEventListener("keydown", (e) => e.key === "Escape" && closeDrawer());

// ------------------------------------------------------------------ policy
async function renderPolicy() {
  const p = await api("/api/policy");
  view.innerHTML = `
    <div class="page-head"><div><h1>Policy</h1><p>The policy turns check results into allow, step-up or block. Change it, run a dry run against everything recorded so far, and apply it only when the changes look right.</p></div></div>
    <div class="policy">
      <div>
        <div class="editor-head"><h2>provethebuy.policy.yaml</h2><span class="sub">Active version <code>${esc(p.version)}</code></span></div>
        <textarea class="code" id="policy-yaml" spellcheck="false" aria-label="Policy YAML" wrap="off" style="min-height:520px">${esc(p.yaml)}</textarea>
        <div class="field-error" id="policy-error" hidden></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="dry" type="button">Dry run</button><button class="btn" id="apply" type="button">Apply policy</button></div>
      </div>
      <div class="panel" id="dry-result"><h2>Dry run</h2><p class="sub">Try changing <code>on_missing</code> to <code>block</code>, or <code>mode</code> to <code>enforce</code>, then press Dry run to see which past requests would be decided differently.</p></div>
    </div>`;
  const err = $("#policy-error");
  $("#dry").addEventListener("click", async () => {
    err.hidden = true;
    $("#dry-result").innerHTML = '<h2>Dry run</h2><p class="sub">Re-checking every recorded request...</p>';
    try {
      const d = await api("/api/policy/dry-run", { method: "POST", body: JSON.stringify({ yaml: $("#policy-yaml").value }) });
      const order = ["allow", "step_up", "block", "not_agent"];
      $("#dry-result").innerHTML = `<h2>Dry run: ${d.changed} of ${d.checked} decisions change</h2>
        <div class="diff-counts">${order.filter((k) => d.counts.before[k] || d.counts.after[k]).map((k) => `<span>${chip(k)} <b>${d.counts.before[k] ?? 0}</b><span class="arrow">to</span><b>${d.counts.after[k] ?? 0}</b></span>`).join("")}</div>
        ${d.changes.length ? `<div class="table-wrap"><table><thead><tr><th>Agent</th><th>Request</th><th>Now</th><th>With this policy</th></tr></thead><tbody>${d.changes.slice(0, 60).map((c) => `<tr class="clickable" data-id="${esc(c.record_id)}"><td>${esc(c.agent ?? "Unsigned")}</td><td><code>${esc(c.method)} ${esc(c.path)}</code></td><td>${chip(c.decision)}</td><td>${chip(c.after)}<div class="reason">${esc(c.after_reason ?? "")}</div></td></tr>`).join("")}</tbody></table></div>` : '<p class="sub">No decisions change.</p>'}`;
      $$("#dry-result tr.clickable").forEach((tr) => tr.addEventListener("click", () => openRecord(tr.dataset.id)));
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      $("#dry-result").innerHTML = '<h2>Dry run</h2><p class="sub">Fix the policy and run again.</p>';
    }
  });
  $("#apply").addEventListener("click", async () => {
    err.hidden = true;
    try {
      const r = await api("/api/policy", { method: "PUT", body: JSON.stringify({ yaml: $("#policy-yaml").value }) });
      toast(`Policy applied (${r.mode === "enforce" ? "enforcing" : "shadow mode"}).`);
      refreshRail();
      renderPolicy();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  });
}

// ------------------------------------------------------------------ disputes
async function renderDisputes(openId) {
  const list = await api("/api/disputes");
  const days = (iso) => Math.ceil((Date.parse(iso) - Date.now()) / 86400e3);
  view.innerHTML = `
    <div class="page-head"><div><h1>Disputes</h1><p>Chargebacks on orders an agent placed. For each one, ProveTheBuy re-checks the stored request with the key snapshot from the day of the order and builds the evidence pack.</p></div></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Dispute</th><th>Agent</th><th>Reason</th><th class="num">Amount</th><th>Respond by</th><th>Status</th></tr></thead>
      <tbody>${
        list
          .map(
            (d) =>
              `<tr class="clickable" data-id="${esc(d.dispute_id)}" tabindex="0"><td><code>${esc(d.dispute_id)}</code></td><td>${esc(d.agent)}</td><td>${esc(reasonLabel(d.reason_code))}</td><td class="num">${esc(d.amount_display)}</td><td>${esc(new Date(d.respond_by).toLocaleDateString([], { month: "short", day: "numeric" }))} <span class="sub">(${days(d.respond_by)} days)</span></td><td>${chip(d.status)}</td></tr>`,
          )
          .join("") || '<tr><td colspan="6" class="empty-state">No disputes. When a chargeback arrives for an agent order, it appears here with its evidence ready.</td></tr>'
      }</tbody></table></div>
    <p class="sub">In the cloud version these arrive from Stripe's dispute webhook and are submitted through the Disputes API. Here, submitting and outcomes are simulated.</p>`;
  $$("tr.clickable").forEach((tr) => {
    tr.addEventListener("click", () => (location.hash = `#/disputes/${tr.dataset.id}`));
    tr.addEventListener("keydown", (e) => e.key === "Enter" && (location.hash = `#/disputes/${tr.dataset.id}`));
  });
  if (openId) openDispute(openId, list.find((d) => d.dispute_id === openId));
}

const REASONS = { "10.4": "Visa 10.4, fraud (card absent)", "13.1": "Visa 13.1, not received", "13.3": "Visa 13.3, not as described", "4837": "Mastercard 4837, not authorised", "4853": "Mastercard 4853, not as described" };
const reasonLabel = (c) => REASONS[c] ?? `Reason ${c}`;

async function openDispute(id, d) {
  const pack = await api(`/api/disputes/${id}/pack`);
  const status = d?.status ?? "opened";
  openDrawer(
    `Dispute ${id}`,
    `<div class="notice ${pack.submittable ? "ok" : "bad"}">${esc(pack.reverification.detail)}</div>
     <p style="margin:0 0 16px"><b>${esc(pack.reason)}</b> on <a href="#/requests/${esc(pack.record_id)}">record ${esc(pack.record_id)}</a>. Status: ${chip(status)}</p>
     <div class="pack">${pack.sections.map((s) => `<section><h3>${esc(s.title)}</h3>${s.title === "Summary" ? `<p>${esc(s.body)}</p>` : `<pre>${esc(s.body)}</pre>`}</section>`).join("")}</div>
     <div class="btn-row">
       ${status === "opened" ? `<button class="btn primary" id="submit-ev" type="button" ${pack.submittable ? "" : "disabled"}>Submit evidence</button>` : ""}
       ${status === "evidence_submitted" ? `<button class="btn" id="mark-won" type="button">Mark as won</button><button class="btn danger" id="mark-lost" type="button">Mark as lost</button>` : ""}
       <button class="btn" id="copy-pack" type="button">Copy evidence text</button>
     </div>`,
  );
  const act = async (what, msg) => {
    try {
      await api(`/api/disputes/${id}/${what}`, { method: "POST" });
      toast(msg);
      closeDrawer();
      refreshRail();
      renderDisputes();
    } catch (e) {
      toast(e.message);
    }
  };
  $("#submit-ev")?.addEventListener("click", () => act("submit", "Evidence submitted."));
  $("#mark-won")?.addEventListener("click", () => act("won", "Marked as won. Agent reputation updated."));
  $("#mark-lost")?.addEventListener("click", () => act("lost", "Marked as lost. Agent reputation updated."));
  $("#copy-pack").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pack.text);
      toast("Evidence text copied.");
    } catch {
      toast("Copy was blocked by the browser.");
    }
  });
}

// ------------------------------------------------------------------ agents
async function renderAgents() {
  const list = await api("/api/agents");
  view.innerHTML = `
    <div class="page-head"><div><h1>Agents</h1><p>Every agent key seen at this store, from your own ledger. Dispute rate feeds the policy: above the threshold, that agent's orders ask the shopper to confirm.</p></div></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Agent</th><th>Directory</th><th class="num">Requests</th><th class="num">Orders</th><th class="num">Blocked</th><th class="num">Outside mandate</th><th class="num">Disputes</th><th class="num">Dispute rate</th><th>Standing</th></tr></thead>
      <tbody>${list
        .map((a) => {
          const rate = a.orders ? a.disputes / a.orders : 0;
          const standing = !a.directory ? ["block", "Not in any directory"] : rate > 0.05 ? ["step_up", "Confirm with shopper"] : ["allow", "Good"];
          return `<tr><td><b>${esc(a.name)}</b><div class="sub"><code>${esc(a.keyid)}</code></div></td><td>${esc(a.directory ? PROTOCOL_LABEL[a.protocol] ?? a.directory : "None")}</td><td class="num">${a.requests}</td><td class="num">${a.orders}</td><td class="num">${a.blocked}</td><td class="num">${a.mismatches}</td><td class="num">${a.disputes}${a.disputesWon || a.disputesLost ? `<div class="sub">${a.disputesWon} won, ${a.disputesLost} lost</div>` : ""}</td><td class="num">${a.orders ? (rate * 100).toFixed(1) + "%" : "–"}</td><td>${chip(standing[0], standing[1])}</td></tr>`;
        })
        .join("")}</tbody></table></div>`;
}

// ------------------------------------------------------------------ pricing
async function renderPricing() {
  const plans = await api("/api/plans");
  const cards = plans
    .map(
      (p) => `
    <div class="plan-card${p.highlighted ? " plan-highlighted" : ""}">
      ${p.highlighted ? '<div class="plan-badge">Most popular</div>' : ""}
      <div class="plan-name">${esc(p.name)}</div>
      <div class="plan-price">${esc(p.price_display)}</div>
      <p class="plan-desc">${esc(p.description)}</p>
      <ul class="plan-features">${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <button class="btn${p.highlighted ? " primary" : ""} plan-cta" data-plan="${esc(p.id)}" type="button">
        Subscribe — ${esc(p.price_display)}
      </button>
    </div>`,
    )
    .join("");
  view.innerHTML = `
    <div class="page-head"><div>
      <h1>Pricing</h1>
      <p>Pick a plan to start verifying agent payments in production. All plans include the full verifier, evidence ledger, and dispute tooling — upgrade as your traffic grows.</p>
    </div></div>
    <div class="plan-grid">${cards}</div>
    <p class="sub" style="margin-top:18px">Clicking Subscribe opens the Dodo Payments checkout in a new tab. No card is charged in this playground environment.</p>`;

  $$(".plan-cta").forEach((btn) =>
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const { checkout_url } = await api(`/api/checkout/${btn.dataset.plan}`, { method: "POST" });
        window.open(checkout_url, "_blank", "noopener");
      } catch (e) {
        toast(e.message);
      } finally {
        btn.disabled = false;
      }
    }),
  );
}

// ------------------------------------------------------------------ router
const ROUTES = { playground: renderPlayground, traffic: renderTraffic, requests: renderRequests, policy: renderPolicy, disputes: renderDisputes, agents: renderAgents, pricing: renderPricing };

async function router() {
  const [, name = "playground", id] = (location.hash || "#/playground").split("/");
  const fn = ROUTES[name] ?? renderPlayground;
  $$("nav a").forEach((a) => (a.dataset.route === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  const d = document.getElementById("drawer");
  if (!id) d.hidden = true;
  try {
    if (id && view.dataset.route === name && name === "requests") return openRecord(id);
    if (id && view.dataset.route === name && name === "disputes") return renderDisputes(id);
    view.dataset.route = name;
    await fn(id);
    if (!id) view.focus({ preventScroll: true });
  } catch (e) {
    view.innerHTML = `<div class="page-head"><div><h1>Something went wrong</h1><p>${esc(e.message)}. Check that the playground server is still running, then reload.</p></div></div>`;
  }
}

$("#reset").addEventListener("click", async () => {
  await api("/api/reset", { method: "POST" });
  pg.request = null;
  toast("Demo data reset: a fresh day of simulated traffic.");
  refreshRail();
  router();
});
window.addEventListener("hashchange", router);
refreshRail();
router();
