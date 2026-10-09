// Self Install: per-customer installer downloads and the page that serves them.
//
// The welcome email's "Install it yourself" section links to
//   GET /install?key=SHOP-XXXX-XXXX-XXXX
// which renders a branded page with two downloads:
//   GET /install-script?key=...&os=windows  -> "Install Blueprint OS.bat"
//   GET /install-script?key=...&os=mac      -> "Install Blueprint OS.command"
// Each file carries the customer's license key in SHOPOS_LICENSE_KEY and
// fetches the always-current setup script from GitHub raw (never from this
// worker's bundled assets, which can go stale between deploys).
//
// Points at shop-os-installer (the WinGet/Homebrew-based flow that installs
// Node, Git, Claude Code and the plugins, shows a folder picker, and launches
// Claude Code at the end). 2026-10-06: briefly pointed at shop-os-dashboard's
// no-admin installer (cutover commit 18543d1), rolled back because that
// installer did not yet install Claude Code or the plugins properly, had no
// folder picker, and failed on a customer's Windows PC. Re-cut over only
// once it reaches parity with this flow.
const RAW_BASE = "https://raw.githubusercontent.com/blueprintit-ai/shop-os-installer/main/scripts";

export type InstallerKind = "legacy" | "v2";

// v2 = the dashboard repo's no-admin starter (shop-os-dashboard/installer/
// start-windows.ps1 and start-macos.sh). Served ONLY to customers whose
// license record is flagged installer:"v2" (or when the DEFAULT_INSTALLER var
// is "v2"); everyone else keeps the legacy flow above. This is the single
// place to repoint the v2 starters (e.g. a tag or a different repo).
// There is deliberately NO automatic fallback to legacy: if these files are
// not reachable, the v2 .bat/.command show "Could not download the Blueprint
// OS setup script" and exit; to roll a customer back, POST
// /admin/set-installer?key=...&installer=legacy.
// Ref the starters (and the package they download) are pinned to: "main", a
// tag, or a 40-hex commit SHA. After the dashboard PR is squash-merged, set
// this to that commit's full SHA in a one-line follow-up BEFORE the first
// customer is flipped to v2; verify both starter URLs return 200 first.
export const V2_INSTALLER_REF = "c9f525ec2ce85dc0fadd2753bff692220ecdd572";
export const V2_RAW_BASE = `https://raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/${V2_INSTALLER_REF}/installer`;

export interface V2Options {
  // Origin of this Worker, passed to the starters as SHOPOS_LICENSE_SERVER.
  licenseServer?: string;
  // Override of V2_INSTALLER_REF (tests). Exported to the starters as SHOPOS_INSTALLER_REF.
  installerRef?: string;
}

const REF_RE = /^[A-Za-z0-9._-]{1,64}$/;
function v2Ref(opts: V2Options): string {
  return opts.installerRef ?? V2_INSTALLER_REF;
}
function v2Base(opts: V2Options): string {
  return `https://raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/${v2Ref(opts)}/installer`;
}

export interface InstallLicenseInfo {
  key: string;
  customer: string;
}

// The customer name is interpolated into a comment line of a .bat and a
// .command. A newline in it would end the comment and run the rest as code,
// so collapse control characters to spaces before it goes in.
function commentSafe(s: string): string {
  return s.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

export function buildWindowsBat(info: InstallLicenseInfo, installer: InstallerKind = "legacy", opts: V2Options = {}): string {
  if (installer === "v2") return buildWindowsBatV2(info, opts);
  // CRLF line endings: cmd.exe misparses bare-LF batch files in some paths.
  //
  // Deliberately NOT an `irm URL | iex` one-liner: that "IEX cradle" shape
  // (bypass policy + env var + pipe a remote fetch into iex, all in one
  // -Command string) is exactly what Defender's cloud ML classifier
  // (Trojan:Win32/Commando.A!ml) keys on, and it flagged this exact command
  // on 2026-09-17. Instead: download the script to disk with a plain,
  // non-executing request, then run that file with -File like any other
  // local script. See notes/windows-defender-false-positive.md in the
  // shop-os-installer repo.
  const lines = [
    "@echo off",
    ":: ==============================================",
    "::  Blueprint OS Foundation - Self Installer (Windows)",
    `::  Licensed to: ${commentSafe(info.customer)}`,
    ":: ==============================================",
    ":: The first time you open this file, Windows may show a blue",
    ':: "Windows protected your PC" screen. Click "More info" then',
    ':: "Run anyway". That prompt appears once.',
    "",
    ":: Relaunch as administrator if we are not already.",
    "net session >nul 2>&1",
    "if %errorLevel% neq 0 (",
    "  echo Blueprint OS setup needs administrator access. Click Yes on the next prompt.",
    "  powershell -NoProfile -Command \"Start-Process -FilePath '%~f0' -Verb RunAs\"",
    // Clicking "No" on the UAC prompt makes Start-Process throw; without this
    // the window closed instantly and the customer saw nothing.
    "  if %errorLevel% neq 0 (",
    "    echo.",
    "    echo Setup was not given administrator access, so it could not start.",
    "    echo Double-click this file again and click Yes on the prompt.",
    "    pause",
    "  )",
    "  exit /b",
    ")",
    "",
    `set "SHOPOS_LICENSE_KEY=${info.key}"`,
    'set "SHOPOS_SETUP_PS1=%TEMP%\\shop-os-setup-%RANDOM%.ps1"',
    "",
    "echo Starting Blueprint OS setup. Keep this window open.",
    // Fetch as text with irm (not `iwr -OutFile`, which dumps raw bytes with
    // no BOM) and write it back out with an explicit UTF-8 BOM. The script
    // has emoji/checkmarks/em-dashes; without a BOM, Windows PowerShell 5.1's
    // -File load falls back to the system codepage, misdecodes them, and
    // that corrupts string/brace parsing a few dozen lines later. -Command
    // string content never hits this because irm decodes straight to an
    // in-memory string, it only bites once the bytes land on disk.
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Invoke-RestMethod -Uri '${RAW_BASE}/setup-windows.ps1' -UseBasicParsing; [System.IO.File]::WriteAllText('%SHOPOS_SETUP_PS1%', $c, (New-Object System.Text.UTF8Encoding($true)))"`,
    'if not exist "%SHOPOS_SETUP_PS1%" (',
    "  echo Could not download the Blueprint OS setup script. Check your internet connection and try again.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%SHOPOS_SETUP_PS1%"',
    'set "SHOPOS_EXIT=%errorLevel%"',
    'del "%SHOPOS_SETUP_PS1%" >nul 2>&1',
    "pause",
    "exit /b %SHOPOS_EXIT%",
    "",
  ];
  return lines.join("\r\n");
}

export function buildMacCommand(info: InstallLicenseInfo, installer: InstallerKind = "legacy", opts: V2Options = {}): string {
  if (installer === "v2") return buildMacCommandV2(info, opts);
  return `#!/bin/bash
# ==============================================
#  Blueprint OS Foundation - Self Installer (Mac)
#  Licensed to: ${commentSafe(info.customer)}
# ==============================================
# The first time you open this file, macOS may say it "cannot be opened
# because it is from an unidentified developer". That is normal:
#   1. Right-click (or Control-click) this file
#   2. Choose "Open"
#   3. Click "Open" again
# You only have to do that once.

export SHOPOS_LICENSE_KEY="${info.key}"

# Download first, then run. A bare \`bash -c "$(curl ...)"\` turns a failed
# download (offline, captive portal, GitHub down) into \`bash -c ""\`, which
# exits 0 and lands on "You can close this window" with nothing installed.
SETUP_SCRIPT="$(curl -fsSL ${RAW_BASE}/setup-macos.sh)"
if [ -z "$SETUP_SCRIPT" ]; then
  echo ""
  echo "Could not download the Blueprint OS setup script. Check your internet connection and try again."
  read -p "Press Return to close this window" < /dev/tty
  exit 1
fi
/bin/bash -c "$SETUP_SCRIPT"
rc=$?
echo ""
if [ "$rc" -ne 0 ]; then
  echo "Setup did not finish (exit code $rc). Scroll up for the reason, fix it, and run this installer again."
  echo "If it keeps failing, send a screenshot of this window to your Blueprint IT contact."
  read -p "Press Return to close this window" < /dev/tty
  exit "$rc"
fi
echo "You can close this window."
`;
}

// v2 interpolates the key and server into batch/bash assignments, so refuse
// anything outside a conservative alphabet instead of trying to escape it.
function assertV2Safe(info: InstallLicenseInfo, opts: V2Options): void {
  if (!REF_RE.test(v2Ref(opts))) throw new Error("unsafe installer ref for v2 installer");
  if (!/^[A-Za-z0-9-]{1,64}$/.test(info.key)) throw new Error("unsafe license key for v2 installer");
  if (opts.licenseServer !== undefined && !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(opts.licenseServer)) {
    throw new Error("unsafe license server for v2 installer");
  }
}

function buildWindowsBatV2(info: InstallLicenseInfo, opts: V2Options): string {
  assertV2Safe(info, opts);
  // No admin relaunch: v2 installs per-user. Same download-to-file + BOM + -File pattern as legacy (no iex cradle).
  const lines = [
    "@echo off",
    ":: ==============================================",
    "::  Blueprint OS Setup (Windows)",
    `::  Licensed to: ${commentSafe(info.customer)}`,
    ":: ==============================================",
    ':: The first time you open this file, Windows may show a blue "Windows protected your PC"',
    ':: screen. Click "More info" then "Run anyway". That prompt appears once.',
    "",
    `set "SHOPOS_LICENSE_KEY=${info.key}"`,
    ...(opts.licenseServer ? [`set "SHOPOS_LICENSE_SERVER=${opts.licenseServer}"`] : []),
    `set "SHOPOS_INSTALLER_REF=${v2Ref(opts)}"`,
    'set "SHOPOS_SETUP_PS1=%TEMP%\\blueprint-os-start-%RANDOM%.ps1"',
    "",
    "echo Starting Blueprint OS setup. Keep this window open.",
    // The temp path is read from the environment inside PowerShell, never
    // embedded in a quoted string: a username with an apostrophe or a
    // typographic quote (O'Brien) would break a single-quoted literal.
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; $c = Invoke-RestMethod -Uri '${v2Base(opts)}/start-windows.ps1' -UseBasicParsing; [System.IO.File]::WriteAllText($env:SHOPOS_SETUP_PS1, $c, (New-Object System.Text.UTF8Encoding($true)))"`,
    'if not exist "%SHOPOS_SETUP_PS1%" (',
    "  echo Could not download the Blueprint OS setup script. Check your internet connection and try again.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%SHOPOS_SETUP_PS1%"',
    'set "SHOPOS_EXIT=%errorLevel%"',
    'del "%SHOPOS_SETUP_PS1%" >nul 2>&1',
    "pause",
    "exit /b %SHOPOS_EXIT%",
    "",
  ];
  return lines.join("\r\n");
}

function buildMacCommandV2(info: InstallLicenseInfo, opts: V2Options): string {
  assertV2Safe(info, opts);
  const server = opts.licenseServer ? `export SHOPOS_LICENSE_SERVER="${opts.licenseServer}"\n` : "";
  return `#!/bin/bash
# ==============================================
#  Blueprint OS Setup (macOS)
#  Licensed to: ${commentSafe(info.customer)}
# ==============================================
# The first time you open this file, macOS may say it "cannot be opened
# because it is from an unidentified developer". That is normal:
# Right-click (or Control-click) this file, choose "Open", then "Open" again.
# You only have to do that once.
export SHOPOS_LICENSE_KEY="${info.key}"
${server}export SHOPOS_INSTALLER_REF="${v2Ref(opts)}"
echo "Starting Blueprint OS setup. Keep this window open."
F="$(mktemp)"
if ! curl -fsSL --connect-timeout 20 -m 120 ${v2Base(opts)}/start-macos.sh -o "$F"; then
  echo "Could not download the Blueprint OS setup script. Check your internet connection and try again."
  read -r -p "Press Enter to close..." _ < /dev/tty
  exit 1
fi
bash "$F"
rc=$?
rm -f "$F"
read -r -p "Press Enter to close..." _ < /dev/tty
exit $rc
`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildInvalidKeyPage(reason: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blueprint OS Install</title></head>
<body style="margin:0;background:#f4efe3;color:#1b1f24;font-family:-apple-system,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:80px auto;padding:0 24px;">
<h1 style="font-size:26px;">This install link isn't active</h1>
<p style="line-height:1.6;color:#4a4d52;">${esc(reason)}</p>
<p style="line-height:1.6;color:#4a4d52;">Reply to your Blueprint OS welcome email and we'll sort it out quickly.</p>
</div></body></html>`;
}

export function buildInstallPage(info: InstallLicenseInfo, bookingUrl: string): string {
  const k = encodeURIComponent(info.key);
  const mono = "font-family:Menlo,'SF Mono',Consolas,monospace;";
  const btn = "display:block;text-align:center;padding:16px 20px;background:#1b1f24;color:#f4efe3;text-decoration:none;font-weight:600;font-size:16px;";
  const card = "background:#fbf8ef;border:1px solid #d8d2c2;padding:20px 22px;margin:0 0 16px;";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install Blueprint OS</title></head>
<body style="margin:0;background:#f4efe3;color:#1b1f24;font-family:-apple-system,'Segoe UI',sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:48px 24px 80px;">

<div style="${mono}font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#7a786f;">Blueprint IT &middot; Blueprint OS Foundation</div>
<h1 style="font-size:30px;line-height:1.15;margin:14px 0 8px;">Install Blueprint OS on your computer</h1>
<p style="line-height:1.6;color:#4a4d52;margin:0 0 6px;">Licensed to <strong>${esc(info.customer)}</strong>. Your installer already carries your license key: nothing to type, nothing to paste.</p>
<p style="line-height:1.6;color:#4a4d52;margin:0 0 28px;">Use the computer your business actually runs on. About 10&ndash;15 minutes.</p>

<div style="${card}" id="win-card">
<div style="${mono}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#b5502b;margin-bottom:10px;">Windows</div>
<a style="${btn}margin-bottom:12px;" href="/install-script?key=${k}&amp;os=windows">Download for Windows</a>
<ol style="margin:0;padding-left:20px;line-height:1.7;color:#4a4d52;font-size:14px;">
<li>Open the downloaded <strong>Install Blueprint OS.bat</strong></li>
<li>Windows shows a blue &ldquo;protected your PC&rdquo; screen once: click <strong>More info</strong>, then <strong>Run anyway</strong></li>
<li>Click <strong>Yes</strong> when asked to allow changes, then follow the window</li>
</ol>
</div>

<div style="${card}" id="mac-card">
<div style="${mono}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#1f7a8c;margin-bottom:10px;">Mac</div>
<a style="${btn}margin-bottom:12px;" href="/install-script?key=${k}&amp;os=mac">Download for Mac</a>
<ol style="margin:0;padding-left:20px;line-height:1.7;color:#4a4d52;font-size:14px;">
<li>Open Downloads. Safari unpacks the zip for you; in other browsers, double-click <strong>Install Blueprint OS.zip</strong> first</li>
<li><strong>Right-click Install Blueprint OS.command, choose Open, then Open again</strong> (one-time security step)</li>
<li>Type your Mac login password when asked and follow the window</li>
</ol>
</div>

<div style="${card}">
<div style="${mono}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7a786f;margin-bottom:10px;">During the install</div>
<ul style="margin:0;padding-left:20px;line-height:1.7;color:#4a4d52;font-size:14px;">
<li>A folder picker opens: choose where your Blueprint OS Vault lives (home folder for one computer; Dropbox, iCloud Drive, or OneDrive to sync across machines)</li>
<li>When Claude Code opens, sign in with your Claude account (claude.ai). No account yet? <a href="https://claude.ai/onboarding" style="color:#1c6ea4;">Create one first</a>: Claude Pro is the right starting point</li>
<li>When everything finishes, type <strong style="${mono}">/bp-setup</strong> in Claude Code to personalize your Shop Brain</li>
</ul>
</div>

<p style="line-height:1.6;color:#4a4d52;font-size:14px;">Anything go sideways? Stop there and <a href="${esc(bookingUrl)}" style="color:#1c6ea4;">book your setup hour</a> or reply to your welcome email: we finish it with you on a screen share. Self-installing does not use up your included setup and training session.</p>

<div id="done-banner" hidden style="border:1px solid #2E7D4F;background:#E7F2E9;color:#1b1f24;padding:18px 22px;margin:24px 0 0;">
<div style="${mono}font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#2E7D4F;margin-bottom:8px;">Install complete</div>
<p style="line-height:1.6;margin:0;">Blueprint OS reported a successful install on this license. Open <strong>Claude Code</strong> in your vault folder and type <strong style="${mono}">/bp-setup</strong> to personalize your Shop Brain &mdash; and see you at your training session.</p>
</div>

<script>
(function(){
  var mac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
  var first = document.getElementById(mac ? "mac-card" : "win-card");
  var second = document.getElementById(mac ? "win-card" : "mac-card");
  if (first && second && second.parentNode) { second.parentNode.insertBefore(first, second); }

  // Flip to the success state once an install reports in (checks ~30 min).
  var tries = 0;
  function check(){
    tries++;
    fetch("/install-status?key=${k}").then(function(r){ return r.json(); }).then(function(d){
      if (d && d.installed) {
        var b = document.getElementById("done-banner");
        if (b) { b.hidden = false; b.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
      } else if (tries < 180) {
        setTimeout(check, 10000);
      }
    }).catch(function(){ if (tries < 180) setTimeout(check, 10000); });
  }
  check();
})();
</script>
</div></body></html>`;
}

// ---------- minimal ZIP (store method) with the Unix exec bit ----------
//
// A bare .command downloaded over HTTP has no execute bit, so macOS refuses
// it with "you do not have appropriate access privileges". Archive Utility
// restores the mode bits recorded in a zip entry's external attributes, so
// serving the .command inside a zip (mode 0755, version-made-by = Unix)
// gives the customer a double-clickable file. Store method keeps this
// dependency-free; the payload is ~1KB.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZipWithExecutable(filename: string, content: string): Uint8Array {
  const enc = new TextEncoder();
  const name = enc.encode(filename);
  const data = enc.encode(content);
  const crc = crc32(data);
  // Fixed DOS timestamp (2026-08-30 12:00) — deterministic output.
  const dosTime = (12 << 11) | (0 << 5) | 0;
  const dosDate = ((2026 - 1980) << 9) | (8 << 5) | 30;
  const extAttrs = (0o100755 << 16) >>> 0; // regular file, rwxr-xr-x

  const local = new Uint8Array(30 + name.length + data.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);          // version needed
  lv.setUint16(6, 0x0800, true);      // flags: UTF-8 names
  lv.setUint16(8, 0, true);           // method: store
  lv.setUint16(10, dosTime, true);
  lv.setUint16(12, dosDate, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, name.length, true);
  lv.setUint16(28, 0, true);
  local.set(name, 30);
  local.set(data, 30 + name.length);

  const central = new Uint8Array(46 + name.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, (3 << 8) | 20, true); // made by: Unix, spec 2.0
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0x0800, true);
  cv.setUint16(10, 0, true);
  cv.setUint16(12, dosTime, true);
  cv.setUint16(14, dosDate, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, name.length, true);
  cv.setUint32(38, extAttrs, true);    // external attrs: mode 0755
  cv.setUint32(42, 0, true);           // local header offset
  central.set(name, 46);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length, true);

  const out = new Uint8Array(local.length + central.length + eocd.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(eocd, local.length + central.length);
  return out;
}
