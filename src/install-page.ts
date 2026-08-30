// Self Install: per-customer installer downloads and the page that serves them.
//
// The welcome email's "Install it yourself" section links to
//   GET /install?key=SHOP-XXXX-XXXX-XXXX
// which renders a branded page with two downloads:
//   GET /install-script?key=...&os=windows  -> "Install Shop OS.bat"
//   GET /install-script?key=...&os=mac      -> "Install Shop OS.command"
// Each file carries the customer's license key in SHOPOS_LICENSE_KEY and
// fetches the always-current setup script from GitHub raw (never from this
// worker's bundled assets, which can go stale between deploys).

const RAW_BASE = "https://raw.githubusercontent.com/blueprintit-ai/shop-os-installer/main/scripts";

export interface InstallLicenseInfo {
  key: string;
  customer: string;
}

export function buildWindowsBat(info: InstallLicenseInfo): string {
  // CRLF line endings: cmd.exe misparses bare-LF batch files in some paths.
  const lines = [
    "@echo off",
    ":: ==============================================",
    "::  Shop OS Foundation - Self Installer (Windows)",
    `::  Licensed to: ${info.customer}`,
    ":: ==============================================",
    ":: The first time you open this file, Windows may show a blue",
    ':: "Windows protected your PC" screen. Click "More info" then',
    ':: "Run anyway". That prompt appears once.',
    "",
    ":: Relaunch as administrator if we are not already.",
    "net session >nul 2>&1",
    "if %errorLevel% neq 0 (",
    "  echo Shop OS setup needs administrator access. Click Yes on the next prompt.",
    "  powershell -NoProfile -Command \"Start-Process -FilePath '%~f0' -Verb RunAs\"",
    "  exit /b",
    ")",
    "",
    "echo Starting Shop OS setup. Keep this window open.",
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:SHOPOS_LICENSE_KEY='${info.key}'; irm ${RAW_BASE}/setup-windows.ps1 | iex"`,
    "pause",
    "",
  ];
  return lines.join("\r\n");
}

export function buildMacCommand(info: InstallLicenseInfo): string {
  return `#!/bin/bash
# ==============================================
#  Shop OS Foundation - Self Installer (Mac)
#  Licensed to: ${info.customer}
# ==============================================
# The first time you open this file, macOS may say it "cannot be opened
# because it is from an unidentified developer". That is normal:
#   1. Right-click (or Control-click) this file
#   2. Choose "Open"
#   3. Click "Open" again
# You only have to do that once.

export SHOPOS_LICENSE_KEY="${info.key}"
/bin/bash -c "$(curl -fsSL ${RAW_BASE}/setup-macos.sh)"
echo ""
echo "You can close this window."
`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildInvalidKeyPage(reason: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shop OS Install</title></head>
<body style="margin:0;background:#f4efe3;color:#1b1f24;font-family:-apple-system,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:80px auto;padding:0 24px;">
<h1 style="font-size:26px;">This install link isn't active</h1>
<p style="line-height:1.6;color:#4a4d52;">${esc(reason)}</p>
<p style="line-height:1.6;color:#4a4d52;">Reply to your Shop OS welcome email and we'll sort it out quickly.</p>
</div></body></html>`;
}

export function buildInstallPage(info: InstallLicenseInfo, bookingUrl: string): string {
  const k = encodeURIComponent(info.key);
  const mono = "font-family:Menlo,'SF Mono',Consolas,monospace;";
  const btn = "display:block;text-align:center;padding:16px 20px;background:#1b1f24;color:#f4efe3;text-decoration:none;font-weight:600;font-size:16px;";
  const card = "background:#fbf8ef;border:1px solid #d8d2c2;padding:20px 22px;margin:0 0 16px;";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install Shop OS</title></head>
<body style="margin:0;background:#f4efe3;color:#1b1f24;font-family:-apple-system,'Segoe UI',sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:48px 24px 80px;">

<div style="${mono}font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#7a786f;">Blueprint IT &middot; Shop OS Foundation</div>
<h1 style="font-size:30px;line-height:1.15;margin:14px 0 8px;">Install Shop OS on your computer</h1>
<p style="line-height:1.6;color:#4a4d52;margin:0 0 6px;">Licensed to <strong>${esc(info.customer)}</strong>. Your installer already carries your license key: nothing to type, nothing to paste.</p>
<p style="line-height:1.6;color:#4a4d52;margin:0 0 28px;">Use the computer your business actually runs on. About 10&ndash;15 minutes.</p>

<div style="${card}" id="win-card">
<div style="${mono}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#b5502b;margin-bottom:10px;">Windows</div>
<a style="${btn}margin-bottom:12px;" href="/install-script?key=${k}&amp;os=windows">Download for Windows</a>
<ol style="margin:0;padding-left:20px;line-height:1.7;color:#4a4d52;font-size:14px;">
<li>Open the downloaded <strong>Install Shop OS.bat</strong></li>
<li>Windows shows a blue &ldquo;protected your PC&rdquo; screen once: click <strong>More info</strong>, then <strong>Run anyway</strong></li>
<li>Click <strong>Yes</strong> when asked to allow changes, then follow the window</li>
</ol>
</div>

<div style="${card}" id="mac-card">
<div style="${mono}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#1f7a8c;margin-bottom:10px;">Mac</div>
<a style="${btn}margin-bottom:12px;" href="/install-script?key=${k}&amp;os=mac">Download for Mac</a>
<ol style="margin:0;padding-left:20px;line-height:1.7;color:#4a4d52;font-size:14px;">
<li>Open Downloads and find <strong>Install Shop OS.command</strong></li>
<li><strong>Right-click it, choose Open, then Open again</strong> (one-time security step)</li>
<li>Type your Mac login password when asked and follow the window</li>
</ol>
</div>

<div style="${card}">
<div style="${mono}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7a786f;margin-bottom:10px;">During the install</div>
<ul style="margin:0;padding-left:20px;line-height:1.7;color:#4a4d52;font-size:14px;">
<li>A folder picker opens: choose where your Shop OS Vault lives (home folder for one computer; Dropbox, iCloud Drive, or OneDrive to sync across machines)</li>
<li>When Claude Code opens, sign in with your Claude account (claude.ai). No account yet? <a href="https://claude.ai/onboarding" style="color:#1c6ea4;">Create one first</a>: Claude Pro is the right starting point</li>
<li>When everything finishes, type <strong style="${mono}">/bp-setup</strong> in Claude Code to personalize your Shop Brain</li>
</ul>
</div>

<p style="line-height:1.6;color:#4a4d52;font-size:14px;">Anything go sideways? Stop there and <a href="${esc(bookingUrl)}" style="color:#1c6ea4;">book your setup hour</a> or reply to your welcome email: we finish it with you on a screen share. Self-installing does not use up your included setup and training session.</p>

<script>
(function(){
  var mac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
  var first = document.getElementById(mac ? "mac-card" : "win-card");
  var second = document.getElementById(mac ? "win-card" : "mac-card");
  if (first && second && second.parentNode) { second.parentNode.insertBefore(first, second); }
})();
</script>
</div></body></html>`;
}
