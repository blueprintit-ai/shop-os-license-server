// Install logs dashboard served at /admin/installs.
// Fetches /list and /admin/install-logs in parallel, joins on license_key
// client-side, and renders a searchable/filterable install monitor.
// Shares the same sessionStorage token as /admin.

export const INSTALLS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shop OS — Install Logs</title>
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
    background: var(--bg); color: var(--ink);
    min-height: 100vh; font-size: 14px; line-height: 1.45;
  }
  header {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 16px 24px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  .back-link {
    color: var(--muted); font-size: 13px; text-decoration: none;
    padding: 6px 10px; border-radius: 5px; border: 1px solid var(--border);
    background: var(--surface); white-space: nowrap;
  }
  .back-link:hover { background: var(--bg); }
  header h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; flex: 1; }
  button {
    font: inherit; cursor: pointer; border-radius: 6px;
    border: 1px solid var(--border); background: var(--surface);
    padding: 8px 14px; color: var(--ink); transition: background 0.1s;
  }
  button:hover { background: var(--bg); }
  button.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
  button.primary:hover { background: #0F172A; }
  button.ghost { background: transparent; border: 1px solid transparent; padding: 6px 10px; }
  button.ghost:hover { background: var(--bg); }
  main { padding: 24px; max-width: 1400px; margin: 0 auto; }
  .stats {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 12px; margin-bottom: 20px;
  }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 14px 16px;
  }
  .stat-card .label {
    color: var(--muted); font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.04em; margin-bottom: 4px;
  }
  .stat-card .value { font-size: 22px; font-weight: 600; }
  .stat-card .value.ok { color: var(--ok); }
  .stat-card .value.danger { color: var(--danger); }
  .toolbar {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px;
  }
  .toolbar input[type="search"] {
    flex: 1; min-width: 200px; padding: 9px 12px;
    border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface); color: var(--ink); font: inherit;
  }
  .toolbar select {
    padding: 9px 12px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface); color: var(--ink); font: inherit;
  }
  .table-wrap {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; overflow-x: auto; box-shadow: var(--shadow);
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  th {
    background: var(--bg); font-weight: 600; font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted);
    white-space: nowrap;
  }
  tr.data-row:last-child td, tr.data-row:last-child ~ tr.err-row td { border-bottom: none; }
  tr.data-row:hover { background: #FAFAF7; }
  tr.data-row.has-error { cursor: pointer; }
  tr.data-row.has-error:hover { background: #FEF7F6; }
  tr.err-row td {
    background: var(--danger-bg); padding: 10px 14px 14px 52px;
    border-left: 3px solid var(--danger); font-size: 12px;
  }
  tr.err-row.hidden { display: none; }
  .err-msg {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 11.5px; color: var(--danger); white-space: pre-wrap;
    word-break: break-word; line-height: 1.55;
  }
  .key {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px; background: var(--bg); padding: 3px 6px; border-radius: 4px;
    cursor: pointer; display: inline-block; white-space: nowrap;
  }
  .key:hover { background: #ECE5D4; }
  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 500; white-space: nowrap;
  }
  .pill.ok { background: var(--ok-bg); color: var(--ok); }
  .pill.error { background: var(--danger-bg); color: var(--danger); }
  .pill.retry { background: #FEF6E0; color: #92511F; }
  .pill.mac { background: #EFF4FA; color: #1F2A44; }
  .pill.win { background: #F0F0FF; color: #3B3B8F; }
  .pill.unk { background: var(--bg); color: var(--muted); }
  .step { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: var(--muted); display: block; margin-top: 3px; }
  .muted { color: var(--muted); font-size: 12px; }
  .customer-name { font-weight: 500; }
  .expand-hint { font-size: 10px; color: var(--muted); margin-left: 5px; vertical-align: middle; }
  .empty { padding: 60px 24px; text-align: center; color: var(--muted); }
  .login {
    max-width: 420px; margin: 80px auto; background: var(--surface);
    border: 1px solid var(--border); border-radius: 10px; padding: 28px;
    box-shadow: var(--shadow);
  }
  .login h2 { margin-bottom: 6px; font-size: 18px; }
  .login p { color: var(--muted); margin-bottom: 20px; font-size: 13px; }
  .login input {
    width: 100%; padding: 10px 12px; border: 1px solid var(--border);
    border-radius: 6px; font: inherit; background: var(--bg);
    font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px;
  }
  .login .primary { width: 100%; margin-top: 12px; padding: 10px; }
  .err-inline { color: var(--danger); font-size: 13px; margin-top: 8px; }
  .toast {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    background: var(--accent); color: var(--accent-fg);
    padding: 10px 18px; border-radius: 6px; font-size: 13px;
    box-shadow: 0 8px 20px rgba(2,3,9,0.25);
    opacity: 0; transition: opacity 0.2s; pointer-events: none;
  }
  .toast.show { opacity: 1; }
  @media (max-width: 760px) {
    main { padding: 14px; }
    th:nth-child(5), td:nth-child(5),
    th:nth-child(6), td:nth-child(6) { display: none; }
  }
</style>
</head>
<body>

<div id="login-view" class="login" hidden>
  <h2>Sign in</h2>
  <p>Enter your admin token. Same token as the licenses page.</p>
  <form id="login-form">
    <input type="password" name="token" placeholder="Bearer token" required autofocus>
    <button type="submit" class="primary">Sign in</button>
    <div id="login-error" class="err-inline" hidden></div>
  </form>
</div>

<div id="app" hidden>
  <header>
    <a href="/admin" class="back-link">&#8592; Licenses</a>
    <h1>Install Logs</h1>
    <button id="refresh-btn" class="ghost" title="Reload">&#8635; Refresh</button>
  </header>
  <main>
    <div class="stats" id="stats"></div>
    <div class="toolbar">
      <input type="search" id="search" placeholder="Search by customer name, license key, or username&#8230;">
      <select id="filter-status">
        <option value="all">All statuses</option>
        <option value="success">Success only</option>
        <option value="error">Errors only</option>
        <option value="retry">Retried steps</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>License key</th>
            <th>Platform</th>
            <th>Status</th>
            <th>User</th>
            <th>OS</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>
      <div id="empty" class="empty" hidden>No install logs found.</div>
    </div>
  </main>
</div>

<div class="toast" id="toast"></div>

<script>
const STATE = {
  token: sessionStorage.getItem('shopos.admin.token'),
  logs: [],
  licenseMap: {}
};
const $ = s => document.querySelector(s);

function toast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms || 2500);
}

async function api(path) {
  const r = await fetch(path, { headers: { 'authorization': 'Bearer ' + STATE.token } });
  let body;
  try { body = await r.json(); } catch { body = {}; }
  return { status: r.status, ok: r.ok, body };
}

function showLogin(err) {
  $('#login-view').hidden = false;
  $('#app').hidden = true;
  const el = $('#login-error');
  if (err) { el.textContent = err; el.hidden = false; }
  else el.hidden = true;
}

function showApp() {
  $('#login-view').hidden = true;
  $('#app').hidden = false;
  loadData();
}

async function loadData() {
  const [logsRes, listRes] = await Promise.all([
    api('/admin/install-logs'),
    api('/list')
  ]);
  if (logsRes.status === 401 || listRes.status === 401) {
    STATE.token = '';
    sessionStorage.removeItem('shopos.admin.token');
    showLogin('Token rejected. Try again.');
    return;
  }
  STATE.licenseMap = {};
  for (const lic of (listRes.body.licenses || [])) {
    STATE.licenseMap[lic.key] = { customer: lic.customer || '', email: lic.email || '' };
  }
  STATE.logs = logsRes.body.logs || [];
  render();
}

function platform(osStr) {
  if (!osStr) return { label: '?', cls: 'unk' };
  const s = osStr.toLowerCase();
  if (s.includes('windows')) return { label: 'Windows', cls: 'win' };
  if (s.includes('darwin') || s.includes('mac')) return { label: 'Mac', cls: 'mac' };
  return { label: '?', cls: 'unk' };
}

function relTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return Math.floor(sec) + 's ago';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  if (sec < 86400 * 30) return Math.floor(sec / 86400) + 'd ago';
  return d.toLocaleDateString();
}

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function osShort(s) {
  if (!s) return '—';
  return esc(s.replace('Microsoft ', '').slice(0, 30));
}

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const filt = $('#filter-status').value;

  const filtered = STATE.logs.filter(log => {
    if (filt !== 'all' && log.status !== filt) return false;
    if (!q) return true;
    const lic = STATE.licenseMap[log.license_key] || {};
    const hay = [log.license_key, lic.customer, lic.email, (log.machine || {}).username].join(' ').toLowerCase();
    return hay.includes(q);
  });

  const total  = STATE.logs.length;
  const succ   = STATE.logs.filter(l => l.status === 'success').length;
  const errs   = STATE.logs.filter(l => l.status === 'error').length;
  const retries= STATE.logs.filter(l => l.status === 'retry').length;
  const day    = STATE.logs.filter(l => (Date.now() - new Date(l.timestamp).getTime()) < 86400000).length;
  const rate   = total > 0 ? Math.round(succ / (total - retries) * 100) : 0;
  const uniq   = new Set(STATE.logs.map(l => l.license_key)).size;

  $('#stats').innerHTML =
    '<div class="stat-card"><div class="label">Total attempts</div><div class="value">' + total + '</div></div>' +
    '<div class="stat-card"><div class="label">Unique keys</div><div class="value">' + uniq + '</div></div>' +
    '<div class="stat-card"><div class="label">Successful</div><div class="value ok">' + succ + '</div></div>' +
    '<div class="stat-card"><div class="label">Errors</div><div class="value' + (errs > 0 ? ' danger' : '') + '">' + errs + '</div></div>' +
    (retries > 0 ? '<div class="stat-card"><div class="label">Retried steps</div><div class="value">' + retries + '</div></div>' : '') +
    '<div class="stat-card"><div class="label">Last 24h</div><div class="value">' + day + '</div></div>' +
    '<div class="stat-card"><div class="label">Success rate</div><div class="value' + (rate >= 80 ? ' ok' : errs > 0 && succ === 0 ? ' danger' : '') + '">' + rate + '%</div></div>';

  const tbody = $('#tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = '';
    $('#empty').hidden = false;
    return;
  }
  $('#empty').hidden = true;

  const rows = [];
  filtered.forEach(function(log, i) {
    const lic = STATE.licenseMap[log.license_key] || {};
    const pf  = platform((log.machine || {}).os);
    const isErr   = log.status === 'error';
    const isRetry = log.status === 'retry';
    const keyDisplay = log.license_key === 'unknown'
      ? '<span class="muted">pre-key entry</span>'
      : '<span class="key" data-key="' + esc(log.license_key) + '">' + esc(log.license_key) + '</span>';
    const customerCell = lic.customer
      ? '<span class="customer-name">' + esc(lic.customer) + '</span>' +
        (lic.email ? '<br><span class="muted">' + esc(lic.email) + '</span>' : '')
      : '<span class="muted">' + (log.license_key === 'unknown' ? '—' : 'key not in licenses') + '</span>';
    const statusCell = isErr
      ? '<span class="pill error">Error</span>' + (log.step ? '<span class="step">' + esc(log.step) + '</span>' : '')
      : isRetry
        ? '<span class="pill retry">Retry</span>' + (log.step ? '<span class="step">' + esc(log.step) + '</span>' : '')
        : '<span class="pill ok">Success</span>';
    const username = esc((log.machine || {}).username || '—');
    const hasDetail = (isErr || isRetry) && log.error_message;

    rows.push(
      '<tr class="data-row' + (hasDetail ? ' has-error' : '') + '" data-i="' + i + '">' +
        '<td>' + customerCell + '</td>' +
        '<td>' + keyDisplay + '</td>' +
        '<td><span class="pill ' + pf.cls + '">' + pf.label + '</span></td>' +
        '<td>' + statusCell + (hasDetail ? '<span class="expand-hint">&#9660;</span>' : '') + '</td>' +
        '<td class="muted">' + username + '</td>' +
        '<td class="muted" style="font-size:11px;">' + osShort((log.machine || {}).os) + '</td>' +
        '<td class="muted" style="white-space:nowrap;">' + relTime(log.timestamp) + '</td>' +
      '</tr>'
    );

    if (hasDetail) {
      rows.push(
        '<tr class="err-row hidden" data-for="' + i + '">' +
          '<td colspan="7"><div class="err-msg">' + esc(log.error_message) + '</div></td>' +
        '</tr>'
      );
    }
  });
  tbody.innerHTML = rows.join('');
}

$('#tbody').addEventListener('click', function(e) {
  const keyEl = e.target.closest('.key');
  if (keyEl) {
    navigator.clipboard.writeText(keyEl.dataset.key);
    toast('Copied ' + keyEl.dataset.key);
    return;
  }
  const row = e.target.closest('tr.has-error');
  if (!row) return;
  const detail = document.querySelector('tr.err-row[data-for="' + row.dataset.i + '"]');
  if (detail) detail.classList.toggle('hidden');
});

$('#login-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const token = (new FormData(e.target).get('token') || '').trim();
  if (!token) return;
  STATE.token = token;
  const r = await api('/admin/install-logs');
  if (r.status === 401) { showLogin('Token rejected.'); return; }
  if (!r.ok) { showLogin('Server error: ' + r.status); return; }
  sessionStorage.setItem('shopos.admin.token', token);
  showApp();
});

$('#refresh-btn').addEventListener('click', loadData);
$('#search').addEventListener('input', render);
$('#filter-status').addEventListener('change', render);

if (STATE.token) showApp();
else showLogin();
</script>
</body>
</html>`;
