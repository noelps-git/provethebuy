// ProveTheBuy playground. Talks to /api/lab/* which runs the real verifier.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (cents) => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
const REPO = "https://github.com/noelps-git/provethebuy";
const SIGNED = new Set(["visa", "mastercard", "wba"]);
const STAMP = { allow: "ALLOW", step_up: "STEP UP", block: "BLOCK", not_agent: "NOT AN AGENT" };
const LEVELS = [
  ["none", "No name, no signature"],
  ["declared", "Names itself only"],
  ["verified", "Signed and verified"],
  ["credentialed", "Signed, with an accountable ID"],
];

const state = { catalog: null, spec: { store: "sneakers", agent: "visa", approval: "passkey", attack: "none", mode: "shadow", withId: false, reason: "10.4" }, out: null, codeTab: "express", fullValues: false };

function track(name, props = {}) {
  try {
    const data = JSON.stringify({ name, props });
    if (!navigator.sendBeacon?.("/api/lab/event", new Blob([data], { type: "application/json" })))
      fetch("/api/lab/event", { method: "POST", body: data, headers: { "content-type": "application/json" }, keepalive: true });
  } catch {}
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2200);
}

async function copy(text, msg = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    toast("Copy failed. Select the text and copy it by hand.");
  }
}

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

// ------------------------------------------------------------------ setup panel

function renderSetup() {
  const c = state.catalog;
  $("#stores").innerHTML = c.stores
    .map((s) => `<label><input type="radio" name="store" value="${s.id}"><b>${esc(s.name)}</b><small>${esc(s.kind)}</small></label>`)
    .join("");
  $("#agents").innerHTML = c.agents
    .map(
      (a) => `<label><input type="radio" name="agent" value="${a.id}"><span><b>${esc(a.name)}</b><small>${esc(a.how)}</small></span><span class="lab-level ${a.level}">${a.level === "verified" ? "SIGNED" : a.level === "declared" ? "NAME ONLY" : "NOTHING"}</span></label>`,
    )
    .join("");
  $("#approvals").innerHTML = c.approvals.map((a) => `<label><input type="radio" name="approval" value="${a.id}"><span><b>${esc(a.name)}</b><small>${esc(a.detail)}</small></span><span></span></label>`).join("");
  $("#reason").innerHTML = c.reasons.map((r) => `<option value="${r.code}">${esc(r.claim)}</option>`).join("");

  const groups = {};
  for (const a of c.attacks) if (a.id !== "none") (groups[a.group] ??= []).push(a);
  $("#attacks").innerHTML = Object.entries(groups)
    .map(
      ([g, list]) =>
        `<div class="lab-attack-group"><h3>${esc(g)}</h3><div>${list
          .map((a) => `<button type="button" class="lab-attack" data-attack="${a.id}" aria-pressed="false"><b>${esc(a.name)}</b><small>${esc(a.detail)}</small></button>`)
          .join("")}</div></div>`,
    )
    .join("");
}

function syncSetup() {
  const s = state.spec;
  const store = state.catalog.stores.find((x) => x.id === s.store);
  $(`input[name=store][value="${s.store}"]`).checked = true;
  $(`input[name=agent][value="${s.agent}"]`).checked = true;
  $(`input[name=approval][value="${s.approval}"]`).checked = true;
  $(`input[name=mode][value="${s.mode}"]`).checked = true;
  $("#ask-text").textContent = store.ask.text;
  $("#cap").value = Math.round((s.cap ?? store.ask.cap) / 100);
  $("#with-id").checked = !!s.withId;
  $("#reason").value = s.reason;
  const signed = SIGNED.has(s.agent);
  $$("input[name=approval]").forEach((i) => (i.disabled = !signed));
  $("#with-id").disabled = !signed;
  $("#id-switch").classList.toggle("is-off", !signed);
  $$(".lab-attack").forEach((b) => {
    b.disabled = !signed;
    b.title = signed ? "" : "Attacks need a signed agent. Pick ShopAssist, CartPilot or Orbit.";
    b.setAttribute("aria-pressed", String(b.dataset.attack === s.attack));
  });
  $("#mode-help").textContent = s.mode === "shadow" ? "Decisions are recorded, nothing is blocked." : "Decisions are applied: step-ups wait for the shopper, blocks are refused.";
}

function readSetup() {
  const v = (n) => $(`input[name=${n}]:checked`)?.value;
  const store = state.catalog.stores.find((x) => x.id === v("store"));
  const capDollars = Number($("#cap").value);
  Object.assign(state.spec, {
    store: v("store"),
    agent: v("agent"),
    approval: v("approval"),
    mode: v("mode"),
    withId: $("#with-id").checked,
    cap: capDollars > 0 ? Math.round(capDollars * 100) : store.ask.cap,
  });
}

// ------------------------------------------------------------------ running

async function run(attack = "none") {
  readSetup();
  state.spec.attack = attack;
  const btn = $("#send");
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const out = await api("/api/lab/run", state.spec);
    state.out = out;
    state.spec = { ...state.spec, ...out.spec };
    syncSetup();
    renderCompare(out);
    renderRequest(out);
    renderResult(out);
    if (!$("#dispute").hidden) renderDispute(out);
    history.replaceState(null, "", "#s=" + encodeSpec(state.spec));
    if (state.ranOnce && matchMedia("(max-width: 820px)").matches) $(".lab-gets").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    state.ranOnce = true;
    $("#edit-note").hidden = false;
  } catch (e) {
    $("#result").innerHTML = `<p class="lab-flag gap"><b>Something went wrong</b>${esc(e.message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Send the agent";
  }
}

const encodeSpec = (s) => btoa(JSON.stringify(s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decodeSpec(h) {
  try {
    return JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ panel 2

function itemRows(order, approved, cap) {
  const it = order?.items?.[0];
  const ap = approved?.items?.[0];
  const d = (a, b) => (a !== b ? ' class="diff"' : "");
  return `
    <dt>Store</dt><dd class="mono${order?.merchant_id !== approved?.merchant_id ? " diff" : ""}">${esc(order?.merchant_id)}</dd>
    <dt>Item</dt><dd${d(it?.name, ap?.name)}>${esc(it?.name)}</dd>
    <dt>Total</dt><dd${order && cap !== undefined && order.total > cap ? ' class="diff"' : d(order?.total, approved?.total)}>${order ? money(order.total) : ""}</dd>`;
}

function renderCompare(out) {
  const s = out.spec;
  const signed = SIGNED.has(s.agent);
  const approval = state.catalog.approvals.find((a) => a.id === (s.attack === "self_approve" ? "chat" : s.approval));
  const approvedCard = signed && approval.id !== "none"
    ? `<div class="lab-card"><h3>The shopper approved</h3><dl>
        <dt>Store</dt><dd class="mono">${esc(out.approved_order.merchant_id)}</dd>
        <dt>Item</dt><dd>${esc(out.approved_order.items[0].name)}</dd>
        <dt>Up to</dt><dd>${money(s.cap)}</dd>
        <dt>Signed by</dt><dd>${esc(approval.name)}</dd></dl></div>`
    : `<div class="lab-card"><h3>The shopper approved</h3><p class="lab-empty">${signed ? "Nothing signed. There is no record of what the shopper allowed." : "Nothing the merchant can check. Unsigned traffic carries no approval."}</p></div>`;
  const sentCard = `<div class="lab-card"><h3>The agent sent</h3><dl>${itemRows(out.sent_order, out.approved_order, signed && approval.id !== "none" ? s.cap : undefined)}</dl></div>`;
  const agent = state.catalog.agents.find((a) => a.id === s.agent);
  const attack = out.attack?.id !== "none" ? `<p class="lab-who"><b>Attack:</b> ${esc(out.attack.name)}. ${esc(out.attack.detail)}</p>` : "";
  $("#view-compare").innerHTML = `<div class="lab-compare">${approvedCard}${sentCard}</div><p class="lab-who"><b>${esc(agent.name)}</b> at <b>${esc(out.store.name)}</b>: ${esc(agent.how)}.</p>${attack}`;
}

function shorten(v) {
  if (state.fullValues) return v;
  if (typeof v === "string" && v.length > 72) return v.slice(0, 34) + "…" + v.slice(-14);
  if (Array.isArray(v)) return v.map(shorten);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x)]));
  return v;
}

function requestText(r, forCopy = false) {
  const lines = [`${r.method} ${r.url}`, ...Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`), "", typeof r.body === "string" ? r.body : r.body ? JSON.stringify(r.body, null, forCopy ? 0 : 2) : ""];
  return lines.join("\n");
}

function renderRequest(out) {
  const r = out.request;
  const head = `<span class="line1">${esc(r.method)} ${esc(r.url)}</span>\n` + Object.entries(r.headers)
    .map(([k, v]) => `<span class="k">${esc(k)}</span>: ${/^signature/.test(k) ? `<span class="sig">${esc(state.fullValues ? v : v.length > 90 ? v.slice(0, 60) + "…" : v)}</span>` : esc(v)}`)
    .join("\n");
  const body = r.body ? esc(typeof r.body === "string" ? r.body : JSON.stringify(shorten(r.body), null, 2)) : "";
  $("#view-request").innerHTML = `<pre class="lab-req">${head}\n\n${body}</pre>
    <div class="lab-row"><button type="button" class="lab-btn lab-btn-line lab-btn-sm" id="toggle-full">${state.fullValues ? "Shorten long values" : "Show full values"}</button>
    <button type="button" class="lab-btn lab-btn-line lab-btn-sm" id="copy-req">Copy request</button></div>`;
  $("#toggle-full").onclick = () => {
    state.fullValues = !state.fullValues;
    renderRequest(out);
  };
  $("#copy-req").onclick = () => copy(requestText(out.request, true), "Request copied");
}

// ------------------------------------------------------------------ panel 3

function ladder(res, out) {
  const idx = LEVELS.findIndex(([k]) => k === res.identification);
  const items = LEVELS.map(([k, label], i) => `<li class="${i === idx ? "on" : i < idx ? "past" : ""}">${esc(label)}</li>`).join("");
  let note;
  if (res.identification === "none" || res.identification === "declared")
    note = `Common in the wild: Arkose Labs saw 66% of AI agent sessions look like ordinary Chrome in the week of 16 to 22 November 2026, and nearly half had no name or signature.`;
  else if (res.identification === "credentialed")
    note = `Signed, and tied to a verified person or organisation through ${esc(res.agent?.agentId?.directory ?? "an ID directory")} without revealing who.`;
  else note = res.agent?.directory ? `Signature checked against the ${esc(res.agent.directory)} key directory.` : "";
  return `<div class="lab-ladder"><div class="lab-label">How strongly the client was identified</div><ol>${items}</ol><small>${note}</small></div>`;
}

const ICON = { pass: "✓", fail: "✗", warn: "!", skip: "–" };
const checksHtml = (checks) =>
  `<ul class="lab-checks">${checks.map((c) => `<li class="${c.status}"><span class="i" aria-label="${c.status}">${ICON[c.status]}</span><span>${esc(c.detail)}<span class="name">${esc(c.name)}</span></span></li>`).join("")}</ul>`;

function verdictFlag(out) {
  const v = out.verdict;
  if (v.kind === "normal") return "";
  if (v.kind === "caught") return `<div class="lab-flag caught"><b>${esc(v.text)}</b>Caught by <code>${esc(v.caught_by.join(", ") || "the decision")}</code>.</div>`;
  if (v.kind === "known_limit") return `<div class="lab-flag known_limit"><b>A known limit, not a hole.</b>${esc(v.text)} Read why below.</div>`;
  const body = encodeURIComponent(`Playground scenario:\n\n${location.origin}/playground#s=${encodeSpec(out.spec)}\n\nDecision: ${out.result.decision}\nChecks:\n${out.result.checks.map((c) => `- ${c.name}: ${c.status}`).join("\n")}\n\nWhat I expected:\n`);
  return `<div class="lab-flag gap"><b>You found a gap.</b>${esc(v.text)} <a href="${REPO}/issues/new?title=${encodeURIComponent("Playground gap: " + out.attack.name)}&body=${body}" target="_blank" rel="noopener" data-track="gap_report">Report it on GitHub</a></div>`;
}

function renderResult(out) {
  const res = out.result;
  const rec = out.record;
  const reasons = res.reasons.join(" ");
  $("#result").innerHTML = `
    <div class="lab-verdict"><span class="lab-stamp ${res.decision} land">${STAMP[res.decision]}</span><p>${esc(reasons)}</p></div>
    ${verdictFlag(out)}
    ${ladder(res, out)}
    <div class="lab-label">Every check</div>
    ${checksHtml(res.checks)}
    <div class="lab-shopper"><span class="code">HTTP ${out.shopper.status} · ${out.spec.mode === "shadow" ? "watch-only mode" : "enforce mode"}</span><b>What the shopper sees: ${esc(out.shopper.title)}</b><p>${esc(out.shopper.body)}</p></div>
    ${out.notes.length ? `<div class="lab-notes">${out.notes.map((n) => `<p>${esc(n)}</p>`).join("")}</div>` : ""}
    <details class="lab-record"><summary>Evidence record filed <span>${esc(rec.record_id)}</span></summary><dl>
      <dt>decision</dt><dd>${esc(rec.decision)}${rec.enforced ? " (enforced)" : " (recorded)"}</dd>
      <dt>identification</dt><dd>${esc(rec.identification)}</dd>
      <dt>agent</dt><dd>${esc(rec.agent?.keyid ?? "none")}${rec.agent?.protocol ? " · " + esc(rec.agent.protocol) : ""}</dd>
      ${rec.agent?.agentId ? `<dt>agent id</dt><dd>${esc(rec.agent.agentId.id)} · ${esc(rec.agent.agentId.directory)}</dd>` : ""}
      <dt>mandate</dt><dd>${rec.mandate ? esc(rec.mandate.type + (rec.mandate.valid ? ", valid" : ", invalid")) : "none"}</dd>
      <dt>order hash</dt><dd>${esc(rec.order?.order_hash ?? "n/a")}</dd>
      <dt>received</dt><dd>${esc(rec.received_at)}</dd>
      <dt>prev hash</dt><dd>${esc(rec.prev_hash)}</dd>
      <dt>hash</dt><dd>${esc(rec.hash)}</dd></dl></details>
    <div class="lab-actions">
      ${out.dispute ? `<button type="button" class="lab-btn" id="go-dispute">Jump 40 days to the dispute</button>` : ""}
      <button type="button" class="lab-btn lab-btn-line" id="open-code">Copy as code</button>
      <button type="button" class="lab-btn lab-btn-line" id="share">Share this scenario</button>
    </div>`;
  $("#go-dispute")?.addEventListener("click", () => {
    $("#dispute").hidden = false;
    renderDispute(state.out);
    $("#dispute").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    track("dispute_view", { store: out.spec.store, decision: res.decision });
  });
  $("#open-code").addEventListener("click", openCode);
  $("#share").addEventListener("click", () => {
    copy(`${location.origin}${location.pathname}#s=${encodeSpec(state.spec)}`, "Link copied. It opens this exact scenario.");
    track("share", { attack: out.spec.attack });
  });
}

// ------------------------------------------------------------------ dispute

function renderDispute(out) {
  const d = out.dispute;
  if (!d) {
    $("#dispute-body").innerHTML = `<p class="lab-empty">No order was placed in this scenario, so there is nothing to dispute.</p>`;
    return;
  }
  const opened = new Date(d.opened_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  $("#dispute-body").innerHTML = `
    <div class="lab-claim"><q>${esc(d.claim)}</q><span>${esc(d.reason_label)} · ${esc(d.amount)} · opened ${esc(opened)}</span></div>
    <div class="lab-vs">
      <div class="lab-without lab-card"><h3>What a merchant has without ProveTheBuy</h3><table>${d.without
        .map(([k, v]) => `<tr><th>${esc(k)}</th><td class="${v === "Unknown" ? "unknown" : ""}">${esc(v)}</td></tr>`)
        .join("")}</table></div>
      <div class="lab-with lab-card"><h3>What the evidence record shows</h3>${d.with.map((s) => `<section><h4>${esc(s.title)}</h4><pre>${esc(s.body)}</pre></section>`).join("")}
        <section><h4>Return policy shown at purchase</h4><pre>${esc(d.return_policy_at_purchase)}</pre></section></div>
    </div>
    ${d.flagged_but_placed ? `<p class="lab-flag known_limit" style="margin-top:14px"><b>Flagged, but let through</b>${esc(d.flagged_but_placed)}</p>` : ""}
    <div class="lab-outcome"><span class="lab-stamp ${d.submittable ? "allow" : "block"}">${d.submittable ? "SUBMITTABLE" : "WEAK CASE"}</span><p>${esc(d.verdict)}</p></div>`;
}

// ------------------------------------------------------------------ code dialog

function openCode() {
  const dlg = $("#code-dialog");
  showCode();
  dlg.showModal();
}
function showCode() {
  const code = state.out?.code;
  if (!code) return;
  $$("#code-dialog [data-code]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.code === state.codeTab)));
  $("#code-pre").textContent = code[state.codeTab];
}

// ------------------------------------------------------------------ bring your own agent

function parseRaw(text) {
  const t = text.trim();
  if (!t) throw new Error("Paste a request first.");
  if (t.startsWith("{")) {
    const j = JSON.parse(t);
    return j.request ?? j;
  }
  const [head, ...rest] = t.split(/\r?\n\r?\n/);
  const lines = head.split(/\r?\n/);
  const m = lines.shift().match(/^([A-Z]+)\s+(\S+)/);
  if (!m) throw new Error("The first line should look like: POST https://shop.example/checkout");
  const headers = {};
  for (const l of lines) {
    const i = l.indexOf(":");
    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  let url = m[2];
  if (url.startsWith("/")) url = `https://${headers.host ?? "shop.example"}${url}`;
  return { method: m[1], url, headers, body: rest.join("\n\n") || undefined };
}

function miniResult(r) {
  return `<div class="lab-verdict"><span class="lab-stamp ${r.decision} land">${STAMP[r.decision]}</span><p>${esc(r.reasons.join(" "))}</p></div>${ladder(r)}${checksHtml(r.checks)}`;
}

async function verifyRaw() {
  const box = $("#raw-result");
  try {
    const request = parseRaw($("#raw").value);
    const r = await api("/api/lab/verify-raw", { request, jwksUrl: $("#raw-jwks").value || undefined, merchantId: $("#raw-merchant").value || undefined });
    box.innerHTML = miniResult(r);
    track("raw_verify", { decision: r.decision });
  } catch (e) {
    box.innerHTML = `<p class="lab-flag gap"><b>Could not check it</b>${esc(e.message)}</p>`;
  }
}

let poll;
async function createSandbox() {
  try {
    const s = await api("/api/lab/sandbox", { jwksUrl: $("#sb-jwks").value || undefined });
    const url = location.origin + s.path;
    $("#sb-url").textContent = url;
    $("#sb-box").hidden = false;
    $("#sb-events").innerHTML = "";
    $("#sb-status").textContent = "Waiting for your agent…";
    clearInterval(poll);
    const started = Date.now();
    poll = setInterval(async () => {
      if (document.hidden) return;
      if (Date.now() - started > 3600e3) {
        clearInterval(poll);
        $("#sb-status").textContent = "This sandbox has expired. Create a new one.";
        return;
      }
      try {
        const events = await api(`/api/lab/sandbox/${s.id}/events`);
        if (events.length) $("#sb-status").textContent = `${events.length} received`;
        $("#sb-events").innerHTML = events
          .map(
            (e) => `<li><div class="top"><span class="meta">${esc(e.method)} ${esc(e.path)} · ${new Date(e.at).toLocaleTimeString()}</span><span class="lab-mini ${e.result.decision}">${STAMP[e.result.decision]}</span></div>
              <div>${esc(e.result.reasons.join(" "))}</div><div class="meta">${esc(e.result.identification)}${e.user_agent ? " · " + esc(e.user_agent.slice(0, 80)) : ""}</div></li>`,
          )
          .join("");
      } catch {}
    }, 3000);
  } catch (e) {
    toast(e.message);
  }
}

// ------------------------------------------------------------------ wiring

function showTab(which) {
  const play = which === "play";
  $("#tab-play").setAttribute("aria-selected", String(play));
  $("#tab-byo").setAttribute("aria-selected", String(!play));
  $("#panel-play").hidden = !play;
  $("#panel-byo").hidden = play;
}

async function init() {
  state.catalog = await api("/api/lab/catalog");
  renderSetup();
  const fromHash = location.hash.startsWith("#s=") ? decodeSpec(location.hash.slice(3)) : null;
  if (fromHash) Object.assign(state.spec, fromHash);
  syncSetup();

  $("#setup").addEventListener("submit", (e) => {
    e.preventDefault();
    run("none");
  });
  $("#setup").addEventListener("change", (e) => {
    if (e.target.name === "store") {
      const st = state.catalog.stores.find((x) => x.id === e.target.value);
      state.spec.store = st.id;
      state.spec.cap = st.ask.cap;
      $("#ask-text").textContent = st.ask.text;
      $("#cap").value = Math.round(st.ask.cap / 100);
    }
    if (e.target.name === "agent") {
      state.spec.agent = e.target.value;
      readSetup();
      syncSetup();
    }
    if (e.target.name === "mode") {
      readSetup();
      syncSetup();
    }
  });
  $("#attacks").addEventListener("click", (e) => {
    const b = e.target.closest("[data-attack]");
    if (!b || b.disabled) return;
    run(b.dataset.attack);
  });
  $("#reason").addEventListener("change", () => {
    state.spec.reason = $("#reason").value;
    run(state.spec.attack).then(() => renderDispute(state.out));
  });
  $$(".lab-sent [data-view]").forEach((b) =>
    b.addEventListener("click", () => {
      $$(".lab-sent [data-view]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      $("#view-compare").hidden = b.dataset.view !== "compare";
      $("#view-request").hidden = b.dataset.view !== "request";
    }),
  );
  $("#tab-play").addEventListener("click", () => showTab("play"));
  $("#tab-byo").addEventListener("click", () => showTab("byo"));
  $$("[data-goto=byo]").forEach((b) => b.addEventListener("click", () => showTab("byo")));
  $$("#code-dialog [data-code]").forEach((b) =>
    b.addEventListener("click", () => {
      state.codeTab = b.dataset.code;
      showCode();
    }),
  );
  $("#code-copy").addEventListener("click", () => {
    copy($("#code-pre").textContent);
    track(state.codeTab === "curl" ? "copy_curl" : "copy_code", { tab: state.codeTab, store: state.spec.store });
  });
  $("#code-dialog [data-close]").addEventListener("click", () => $("#code-dialog").close());
  $("#quickstart-link").addEventListener("click", () => track("install_click", { from: "code_dialog" }));
  $("#raw-verify").addEventListener("click", verifyRaw);
  $("#raw-sample").addEventListener("click", () => {
    if (!state.out) return toast("Send an agent in the playground first.");
    $("#raw").value = requestText(state.out.request, true);
    $("#raw-merchant").value = state.out.store.merchant;
  });
  $("#sb-create").addEventListener("click", createSandbox);
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-copy]");
    if (c) copy($(c.dataset.copy).textContent);
    const t = e.target.closest("[data-track]");
    if (t) track(t.dataset.track, { attack: state.spec.attack });
  });

  run(state.spec.attack || "none");
}

init().catch((e) => {
  $("#result").innerHTML = `<p class="lab-flag gap"><b>The playground could not load</b>${esc(e.message)}</p>`;
});
