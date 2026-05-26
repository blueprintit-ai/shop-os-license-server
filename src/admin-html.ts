// The admin UI is a single self-contained HTML page served at /admin.
// All admin actions (list, issue, revoke) call the Worker's existing API
// with a Bearer token the operator enters once and keeps in sessionStorage.
// No build step. No external CDN dependencies.

export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shop OS Licenses</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #F4EFE3;
    --surface: #FFFFFF;
    --ink: #020309;
    --muted: #6B6358;
    --accent: #1F2937;
    --accent-fg: #FFFFFF;
    --border: #E2DBC9;
    --danger: #B42318;
    --danger-bg: #FEF3F2;
    --ok: #067647;
    --ok-bg: #ECFDF3;
    --shadow: 0 1px 2px rgba(2,3,9,0.04), 0 1px 1px rgba(2,3,9,0.04);
  }
  html, body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: var(--bg);
    color: var(--ink);
    min-height: 100vh;
    font-size: 14px;
    line-height: 1.45;
  }
  header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 12px;
  }
  header h1 {
    font-size: 18px; font-weight: 600; letter-spacing: -0.01em;
  }
  header .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  button {
    font: inherit; cursor: pointer; border-radius: 6px;
    border: 1px solid var(--border); background: var(--surface);
    padding: 8px 14px; color: var(--ink);
    transition: background 0.1s, border-color 0.1s;
  }
  button:hover { background: var(--bg); }
  button.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
  button.primary:hover { background: #0F172A; }
  button.danger { color: var(--danger); border-color: #FBC5C1; background: var(--danger-bg); }
  button.danger:hover { background: #FEE4E2; }
  button.ghost { background: transparent; border: 1px solid transparent; padding: 6px 10px; }
  button.ghost:hover { background: var(--bg); }
  main { padding: 24px; max-width: 1400px; margin: 0 auto; }
  .stats {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px; margin-bottom: 20px;
  }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 14px 16px;
  }
  .stat-card .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
  .stat-card .value { font-size: 22px; font-weight: 600; }
  .toolbar {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px;
  }
  .toolbar input[type="search"] {
    flex: 1; min-width: 220px;
    padding: 9px 12px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface); color: var(--ink); font: inherit;
  }
  .toolbar select {
    padding: 9px 12px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface); color: var(--ink); font: inherit;
  }
  .table-wrap {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; overflow: hidden; box-shadow: var(--shadow);
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 12px 14px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { background: var(--bg); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); }
  tr:last-child td { border-bottom: none; }
  tr:hover { background: var(--bg); }
  .key {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px; background: var(--bg); padding: 3px 6px; border-radius: 4px;
    cursor: pointer; display: inline-block;
  }
  .key:hover { background: #ECE5D4; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; }
  .pill.entitlement { background: var(--bg); color: var(--ink); margin-right: 4px; }
  .pill.product { background: #EFF4FA; color: #1F2A44; }
  .pill.status-active { background: var(--ok-bg); color: var(--ok); }
  .pill.status-revoked { background: var(--danger-bg); color: var(--danger); }
  .pill.status-expired { background: #FEF6E0; color: #92511F; }
  .muted { color: var(--muted); font-size: 12px; }
  .row-actions { display: flex; gap: 4px; justify-content: flex-end; }
  .empty {
    padding: 60px 24px; text-align: center; color: var(--muted);
  }
  .login {
    max-width: 420px; margin: 80px auto; background: var(--surface);
    border: 1px solid var(--border); border-radius: 10px; padding: 28px;
    box-shadow: var(--shadow);
  }
  .login h2 { margin-bottom: 6px; font-size: 18px; }
  .login p { color: var(--muted); margin-bottom: 20px; }
  .login input {
    width: 100%; padding: 10px 12px; border: 1px solid var(--border);
    border-radius: 6px; font: inherit; background: var(--bg);
    font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px;
  }
  .login button { width: 100%; margin-top: 12px; padding: 10px; }
  dialog {
    border: 1px solid var(--border); border-radius: 10px; padding: 0;
    background: var(--surface); color: var(--ink);
    max-width: 480px; width: 90%;
    box-shadow: 0 20px 40px rgba(2,3,9,0.18);
  }
  dialog::backdrop { background: rgba(2,3,9,0.4); }
  dialog .head { padding: 18px 20px 12px; }
  dialog .head h2 { font-size: 16px; font-weight: 600; }
  dialog .body { padding: 0 20px 16px; }
  dialog .foot {
    padding: 12px 20px; border-top: 1px solid var(--border);
    display: flex; gap: 8px; justify-content: flex-end;
  }
  dialog label { display: block; margin-bottom: 12px; font-size: 13px; }
  dialog label span { display: block; color: var(--muted); margin-bottom: 4px; font-size: 12px; }
  dialog input, dialog textarea {
    width: 100%; padding: 8px 10px; border: 1px solid var(--border);
    border-radius: 6px; font: inherit; background: var(--surface);
  }
  dialog textarea { font-family: ui-monospace, Menlo, monospace; font-size: 12px; resize: vertical; min-height: 120px; }
  .new-key {
    font-family: ui-monospace, Menlo, monospace; font-size: 16px;
    padding: 12px 14px; background: var(--bg); border-radius: 6px;
    text-align: center; user-select: all; cursor: text; margin-bottom: 12px;
  }
  .error { color: var(--danger); font-size: 13px; margin-top: 8px; }
  .toast {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    background: var(--accent); color: var(--accent-fg);
    padding: 10px 18px; border-radius: 6px; font-size: 13px;
    box-shadow: 0 8px 20px rgba(2,3,9,0.25);
    opacity: 0; transition: opacity 0.2s; pointer-events: none;
  }
  .toast.show { opacity: 1; }
  @media (max-width: 720px) {
    main { padding: 14px; }
    th:nth-child(3), td:nth-child(3),
    th:nth-child(6), td:nth-child(6),
    th:nth-child(7), td:nth-child(7),
    th:nth-child(8), td:nth-child(8) { display: none; }
  }
</style>
</head>
<body>

<div id="login-view" class="login" hidden>
  <h2>Sign in</h2>
  <p>Paste your admin token to manage Shop OS licenses. The token is the same value you set via <code>wrangler secret put ADMIN_TOKEN</code>.</p>
  <form id="login-form">
    <input type="password" name="token" placeholder="Bearer token" required autofocus>
    <button type="submit" class="primary">Sign in</button>
    <div id="login-error" class="error" hidden></div>
  </form>
</div>

<div id="app" hidden>
  <header>
    <h1>Shop OS Licenses</h1>
    <div class="actions">
      <button id="refresh-btn" class="ghost" title="Reload from server">↻ Refresh</button>
      <button id="signout-btn" class="ghost">Sign out</button>
      <button id="issue-btn" class="primary">+ Issue License</button>
    </div>
  </header>
  <main>
    <div class="stats" id="stats"></div>
    <div class="toolbar">
      <input type="search" id="search" placeholder="Search by customer, email, or key…">
      <select id="filter-status">
        <option value="all">All</option>
        <option value="active">Active only</option>
        <option value="revoked">Revoked only</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Customer</th>
            <th>Email</th>
            <th>Product</th>
            <th>Entitlements</th>
            <th>Created</th>
            <th>Last seen</th>
            <th>Activations</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
      <div id="empty" class="empty" hidden>No licenses match the current filter.</div>
    </div>
  </main>
</div>

<dialog id="issue-dialog">
  <form id="issue-form">
    <div class="head"><h2>Issue New License</h2></div>
    <div class="body">
      <label><span>Customer name</span><input name="customer" required></label>
      <label><span>Customer email</span><input name="email" type="email" required></label>
      <label><span>Product</span><input name="product" value="shop-os-foundation"></label>
      <label><span>Entitlements (comma separated)</span><input name="entitlements" value="foundation"></label>
      <label><span>Valid until (ISO date, leave blank for perpetual)</span><input name="valid_until" placeholder="e.g. 2027-05-24T00:00:00.000Z"></label>
      <div id="issue-error" class="error" hidden></div>
    </div>
    <div class="foot">
      <button type="button" value="cancel">Cancel</button>
      <button type="submit" class="primary">Issue</button>
    </div>
  </form>
</dialog>

<dialog id="key-dialog">
  <div class="head"><h2>License issued</h2></div>
  <div class="body">
    <p class="muted" style="margin-bottom:10px;">Copy this key and send it to the customer.</p>
    <div class="new-key" id="new-key-value"></div>
    <button type="button" id="copy-key-btn">Copy to clipboard</button>
    <button type="button" id="email-template-btn" style="margin-left:6px;">Show email template</button>
    <textarea id="email-template" hidden style="margin-top:12px;" readonly rows="10"></textarea>
  </div>
  <div class="foot">
    <button type="button" id="key-dialog-close" class="primary">Done</button>
  </div>
</dialog>

<dialog id="revoke-dialog">
  <div class="head"><h2>Revoke license?</h2></div>
  <div class="body">
    <p class="muted">This marks <strong id="revoke-key"></strong> as cancelled. Subsequent installer validations will return 403. Cannot be undone via this UI (you can re-issue a new key for the customer).</p>
  </div>
  <div class="foot">
    <button type="button" value="cancel">Cancel</button>
    <button type="button" id="revoke-confirm" class="danger">Revoke</button>
  </div>
</dialog>

<div class="toast" id="toast"></div>

<script>
const STATE = { token: sessionStorage.getItem("shopos.admin.token"), licenses: [] };
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function toast(msg, ms = 2500) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), ms);
}

async function api(path, options = {}) {
  const opts = { ...options, headers: { ...(options.headers || {}) } };
  if (STATE.token) opts.headers["authorization"] = "Bearer " + STATE.token;
  if (opts.body && typeof opts.body !== "string") {
    opts.body = JSON.stringify(opts.body);
    opts.headers["content-type"] = "application/json";
  }
  const r = await fetch(path, opts);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, ok: r.ok, body };
}

function showLogin(errorMsg) {
  $("#login-view").hidden = false;
  $("#app").hidden = true;
  const err = $("#login-error");
  if (errorMsg) { err.textContent = errorMsg; err.hidden = false; }
  else { err.hidden = true; }
}

function showApp() {
  $("#login-view").hidden = true;
  $("#app").hidden = false;
  refresh();
}

async function refresh() {
  const r = await api("/list");
  if (r.status === 401) { STATE.token = ""; sessionStorage.removeItem("shopos.admin.token"); showLogin("Token rejected. Try again."); return; }
  if (!r.ok) { toast("List failed: " + (r.body.error || r.status)); return; }
  STATE.licenses = r.body.licenses || [];
  render();
}

function fmtDate(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return Math.floor(diff) + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + "d ago";
  return d.toLocaleDateString();
}

function statusOf(lic) {
  if (lic.cancelled_at) return "revoked";
  if (lic.valid_until && new Date(lic.valid_until).getTime() < Date.now()) return "expired";
  return "active";
}

function render() {
  const q = $("#search").value.trim().toLowerCase();
  const filter = $("#filter-status").value;
  const list = STATE.licenses.filter(l => {
    const s = statusOf(l);
    if (filter === "active" && s !== "active") return false;
    if (filter === "revoked" && s !== "revoked") return false;
    if (!q) return true;
    return (l.key + " " + (l.customer || "") + " " + (l.email || "")).toLowerCase().includes(q);
  });

  // sort: active first, then by created_at desc
  list.sort((a, b) => {
    const sa = statusOf(a) === "active" ? 0 : 1;
    const sb = statusOf(b) === "active" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });

  // stats
  const active = STATE.licenses.filter(l => statusOf(l) === "active").length;
  const revoked = STATE.licenses.filter(l => statusOf(l) === "revoked").length;
  const monthAgo = Date.now() - 30 * 86400 * 1000;
  const recent = STATE.licenses.filter(l => l.created_at && new Date(l.created_at).getTime() > monthAgo).length;
  $("#stats").innerHTML = [
    \`<div class="stat-card"><div class="label">Total</div><div class="value">\${STATE.licenses.length}</div></div>\`,
    \`<div class="stat-card"><div class="label">Active</div><div class="value">\${active}</div></div>\`,
    \`<div class="stat-card"><div class="label">Revoked</div><div class="value">\${revoked}</div></div>\`,
    \`<div class="stat-card"><div class="label">Issued (30d)</div><div class="value">\${recent}</div></div>\`,
  ].join("");

  const tbody = $("#tbody");
  if (list.length === 0) {
    tbody.innerHTML = "";
    $("#empty").hidden = false;
    return;
  }
  $("#empty").hidden = true;
  tbody.innerHTML = list.map(l => {
    const s = statusOf(l);
    const ents = (l.entitlements || []).map(e => \`<span class="pill entitlement">\${escapeHtml(e)}</span>\`).join("");
    const isActive = s === "active";
    const revokeBtn = isActive
      ? \`<button class="danger" data-action="revoke" data-key="\${l.key}">Revoke</button>\`
      : "";
    return \`<tr>
      <td><span class="key" data-key="\${l.key}" title="Click to copy">\${l.key}</span></td>
      <td><strong>\${escapeHtml(l.customer || "")}</strong></td>
      <td class="muted">\${escapeHtml(l.email || "")}</td>
      <td><span class="pill product">\${escapeHtml(l.product || "")}</span></td>
      <td>\${ents}</td>
      <td class="muted">\${fmtDate(l.created_at)}</td>
      <td class="muted">\${fmtDate(l.last_seen)}</td>
      <td class="muted">\${l.activations || 0}</td>
      <td><span class="pill status-\${s}">\${s}</span></td>
      <td class="row-actions">\${revokeBtn}</td>
    </tr>\`;
  }).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "'": "&#39;" }[c]));
}

// ---- handlers ----

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = new FormData(e.target).get("token").trim();
  if (!token) return;
  STATE.token = token;
  const r = await api("/list");
  if (r.status === 401) { showLogin("Token rejected."); return; }
  if (!r.ok) { showLogin("Server error: " + r.status); return; }
  sessionStorage.setItem("shopos.admin.token", token);
  showApp();
});

$("#signout-btn").addEventListener("click", () => {
  STATE.token = "";
  sessionStorage.removeItem("shopos.admin.token");
  showLogin();
});

$("#refresh-btn").addEventListener("click", refresh);
$("#search").addEventListener("input", render);
$("#filter-status").addEventListener("change", render);

$("#tbody").addEventListener("click", (e) => {
  const keyEl = e.target.closest(".key");
  if (keyEl) {
    navigator.clipboard.writeText(keyEl.dataset.key);
    toast("Copied " + keyEl.dataset.key);
    return;
  }
  const action = e.target.dataset.action;
  if (action === "revoke") {
    const key = e.target.dataset.key;
    $("#revoke-key").textContent = key;
    $("#revoke-confirm").dataset.key = key;
    $("#revoke-dialog").showModal();
  }
});

$("#revoke-confirm").addEventListener("click", async () => {
  const key = $("#revoke-confirm").dataset.key;
  const r = await api("/revoke?key=" + encodeURIComponent(key), { method: "POST" });
  $("#revoke-dialog").close();
  if (!r.ok) { toast("Revoke failed: " + (r.body.error || r.status)); return; }
  toast("Revoked " + key);
  refresh();
});

$("#issue-btn").addEventListener("click", () => {
  $("#issue-error").hidden = true;
  $("#issue-form").reset();
  $("#issue-form").querySelector("[name=product]").value = "shop-os-foundation";
  $("#issue-form").querySelector("[name=entitlements]").value = "foundation";
  $("#issue-dialog").showModal();
});

$$("dialog button[value=cancel]").forEach(b => {
  b.addEventListener("click", () => b.closest("dialog").close());
});

$("#issue-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    customer: fd.get("customer").trim(),
    email: fd.get("email").trim(),
    product: (fd.get("product") || "").trim() || "shop-os-foundation",
    entitlements: (fd.get("entitlements") || "").split(",").map(s => s.trim()).filter(Boolean),
  };
  const validUntil = (fd.get("valid_until") || "").trim();
  if (validUntil) body.valid_until = validUntil;

  const r = await api("/issue", { method: "POST", body });
  if (!r.ok) {
    const err = $("#issue-error");
    err.textContent = "Issue failed: " + (r.body.error || r.status);
    err.hidden = false;
    return;
  }
  $("#issue-dialog").close();
  showNewKey(r.body.license);
  refresh();
});

function showNewKey(lic) {
  $("#new-key-value").textContent = lic.key;
  $("#email-template").value = buildEmailTemplate(lic);
  $("#email-template").hidden = true;
  $("#key-dialog").showModal();
}

function buildEmailTemplate(lic) {
  return [
    \`Subject: Welcome to Shop OS — your license key inside\`,
    \`\`,
    \`Hi \${lic.customer},\`,
    \`\`,
    \`Welcome to Shop OS. Your license key is:\`,
    \`\`,
    \`    \${lic.key}\`,
    \`\`,
    \`To install:\`,
    \`\`,
    \`1. Sign up for Claude Max at https://claude.ai (~$100/month).\`,
    \`2. Install Claude Code from https://claude.ai/code.\`,
    \`3. Open Terminal (Mac) or PowerShell (Windows) and paste:\`,
    \`\`,
    \`    npx @blueprintit/shop-os-install\`,
    \`\`,
    \`4. Paste your license key when prompted.\`,
    \`\`,
    \`Reply to this email with any questions.\`,
    \`\`,
    \`— Blueprint IT\`,
  ].join("\\n");
}

$("#copy-key-btn").addEventListener("click", () => {
  navigator.clipboard.writeText($("#new-key-value").textContent);
  toast("Key copied");
});

$("#email-template-btn").addEventListener("click", () => {
  const ta = $("#email-template");
  ta.hidden = !ta.hidden;
  if (!ta.hidden) ta.select();
});

$("#key-dialog-close").addEventListener("click", () => $("#key-dialog").close());

// boot
if (STATE.token) showApp();
else showLogin();
</script>
</body>
</html>`;
