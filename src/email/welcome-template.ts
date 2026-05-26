export interface WelcomeTemplateInput {
  customerName: string;
  licenseKey: string;
  pdfUrl: string;
}

export function welcomeSubject(): string {
  return "Welcome to Shop OS, your license key and install instructions";
}

export function welcomeText(input: WelcomeTemplateInput): string {
  return `Hi ${input.customerName},

Thanks for picking up Shop OS Foundation. Your license key is below, along
with everything you need to get installed in the next 15 minutes.


YOUR LICENSE KEY
${"─".repeat(60)}
        ${input.licenseKey}
${"─".repeat(60)}

Save this key somewhere safe (1Password, a sticky note, an email folder).
You will paste it once during install. We will never ask you to re-enter
it after that.


INSTALL SHOP OS
${"─".repeat(60)}

The full install guide is attached to this email as a PDF. You can also
re-download it any time from:

    ${input.pdfUrl}

Open the PDF and follow the four prerequisite installs (Claude Max, Node.js,
Claude Code, Obsidian), then run this one command in Terminal (Mac) or
PowerShell (Windows):

    npx -y --package=github:blueprintit-ai/shop-os-installer shop-os-install

When the installer asks for your license key, paste this:

    ${input.licenseKey}


NEED HELP?
${"─".repeat(60)}

Reply to this email. A real human (Glenn) reads every message and
responds within one business hour.

Welcome aboard.

, Glenn Chua
  Blueprint IT
  glenn@blueprintit.ai
`;
}

export function welcomeHtml(input: WelcomeTemplateInput): string {
  const safeName = escapeHtml(input.customerName);
  const safeKey = escapeHtml(input.licenseKey);
  const safeUrl = escapeAttr(input.pdfUrl);
  return `<!doctype html>
<html><body style="background:#F4EFE3;color:#020309;font-family:Menlo,Consolas,monospace;font-size:14px;line-height:1.6;padding:24px;">
<div style="max-width:600px;margin:0 auto;">
<h1 style="font-size:20px;margin:0 0 16px;">Welcome to Shop OS</h1>
<p>Hi ${safeName},</p>
<p>Thanks for picking up Shop OS Foundation. Your license key is below, along with everything you need to get installed in the next 15 minutes.</p>

<h2 style="font-size:14px;letter-spacing:1px;text-transform:uppercase;color:#5c5849;margin-top:24px;">Your license key</h2>
<div style="background:#ebe5d3;border:1px solid #d6cdb6;padding:16px;text-align:center;font-size:18px;letter-spacing:2px;">${safeKey}</div>
<p style="font-size:13px;color:#5c5849;">Save this somewhere safe (1Password, a sticky note, an email folder). You will paste it once during install. We will never ask you to re-enter it after that.</p>

<h2 style="font-size:14px;letter-spacing:1px;text-transform:uppercase;color:#5c5849;margin-top:24px;">Install Shop OS</h2>
<p>The full install guide is attached to this email as a PDF. You can also <a href="${safeUrl}" style="color:#8a3a1e;">re-download it any time</a>.</p>
<p>Open the PDF and follow the four prerequisite installs (Claude Max, Node.js, Claude Code, Obsidian), then run this one command in Terminal (Mac) or PowerShell (Windows):</p>
<pre style="background:#ebe5d3;border:1px solid #d6cdb6;padding:12px;overflow-x:auto;">npx -y --package=github:blueprintit-ai/shop-os-installer shop-os-install</pre>
<p>When the installer asks for your license key, paste this:</p>
<pre style="background:#ebe5d3;border:1px solid #d6cdb6;padding:12px;">${safeKey}</pre>

<h2 style="font-size:14px;letter-spacing:1px;text-transform:uppercase;color:#5c5849;margin-top:24px;">Need help?</h2>
<p>Reply to this email. A real human (Glenn) reads every message and responds within one business hour.</p>

<p>Welcome aboard.</p>
<p>, Glenn Chua<br/>Blueprint IT<br/><a href="mailto:glenn@blueprintit.ai" style="color:#8a3a1e;">glenn@blueprintit.ai</a></p>
</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
