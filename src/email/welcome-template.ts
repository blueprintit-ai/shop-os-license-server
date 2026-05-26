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
with everything you need to get installed in under 30 minutes.


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

Reply to your welcome email. We will respond ASAP.

Welcome aboard.

Glenn Chua, Founder
Blueprint IT, LLC
glenn@blueprintit.ai
www.blueprintit.ai
`;
}

// Visual brand language matches blueprintit.ai/shop-ossi:
// warm paper background, cyan + rust accents, "Blueprint" + italic rust "IT"
// wordmark, cyan section rules, monospace section markers.
// All CSS is inline (no <style>) for max email-client compatibility
// (Gmail, Outlook, Apple Mail). The node-cloud brain banner used in the
// PDFs is intentionally NOT included here — at 32KB base64 it would push
// the message near Gmail's 102KB clip threshold and external images get
// blocked by default in most clients. Brand identity carries via color +
// typography.
export function welcomeHtml(input: WelcomeTemplateInput): string {
  const safeName = escapeHtml(input.customerName);
  const safeKey = escapeHtml(input.licenseKey);
  const safeUrl = escapeAttr(input.pdfUrl);

  // Palette (matches blueprintit.ai/shop-ossi):
  //   paper #f4efe3, paper-2 #ede6d4, paper-line #d9ceb0
  //   ink #0c1e2f, ink-soft #2a3f55, ink-mute #6a7788
  //   cyan #1c6ea4, rust #c2461f

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Welcome to Shop OS</title>
</head>
<body style="margin:0;padding:0;background:#f4efe3;color:#0c1e2f;font-family:Georgia,'Iowan Old Style',serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f4efe3;">
<tr><td align="center" style="padding:32px 16px;">

<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;">

<!-- Top cyan rule -->
<tr><td style="border-top:3px solid #1c6ea4;height:0;line-height:0;font-size:0;">&nbsp;</td></tr>

<!-- Wordmark + doc number -->
<tr><td style="padding:14px 0 18px;border-bottom:1px solid #d9ceb0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
<tr>
<td style="font-family:Georgia,serif;font-size:15px;font-weight:600;color:#0c1e2f;letter-spacing:-0.005em;">Blueprint<em style="font-style:italic;color:#c2461f;font-weight:600;">IT</em><span style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#2a3f55;font-weight:400;font-style:normal;margin-left:10px;">&nbsp;&nbsp;Schematics for the AI-native business</span></td>
<td align="right" style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:1.4px;color:#1c6ea4;white-space:nowrap;">DOC § SOS-WELCOME-01</td>
</tr>
</table>
</td></tr>

<!-- Title + tagline -->
<tr><td style="padding:24px 0 4px;">
<h1 style="font-family:Georgia,serif;font-size:28px;font-weight:600;margin:0;color:#0c1e2f;letter-spacing:-0.01em;line-height:1.1;">Welcome to Shop OS</h1>
<div style="font-family:Menlo,'SF Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:2.4px;color:#1c6ea4;margin-top:8px;">Your license, install steps, and first session</div>
</td></tr>

<!-- Greeting -->
<tr><td style="padding:22px 0 0;">
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:0 0 12px;">Hi ${safeName},</p>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:0 0 4px;">Thanks for picking up <em style="font-style:italic;color:#1c6ea4;">Shop OS Foundation</em>. Your license key is below, along with everything you need to get installed in under 30 minutes.</p>
</td></tr>

<!-- § 01 License key -->
<tr><td style="padding:28px 0 0;">
<div style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#1c6ea4;border-top:1px solid #1c6ea4;padding-top:14px;margin-bottom:6px;">§ 01 &nbsp;·&nbsp; Your license key</div>
<div style="background:#ede6d4;border-left:3px solid #1c6ea4;padding:20px 16px;text-align:center;font-family:Menlo,'SF Mono',monospace;font-size:18px;letter-spacing:3px;color:#0c1e2f;font-weight:600;margin-top:8px;">${safeKey}</div>
<p style="font-family:Georgia,serif;font-size:13px;line-height:1.55;color:#2a3f55;margin:10px 0 0;font-style:italic;">Save this somewhere safe. You will paste it once during install. We will never ask you to re-enter it.</p>
</td></tr>

<!-- § 02 Install -->
<tr><td style="padding:28px 0 0;">
<div style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#1c6ea4;border-top:1px solid #1c6ea4;padding-top:14px;margin-bottom:6px;">§ 02 &nbsp;·&nbsp; Install Shop OS</div>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:8px 0 12px;">The full install guide is attached to this email as a PDF. You can also <a href="${safeUrl}" style="color:#1c6ea4;text-decoration:underline;text-underline-offset:2px;">re-download it any time</a>.</p>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:0 0 8px;">Open the PDF and follow the four prerequisites (Claude Max, Node.js, Claude Code, Obsidian), then run this one command in Terminal (Mac) or PowerShell (Windows):</p>
<div style="background:#ede6d4;border-left:3px solid #1c6ea4;padding:14px 14px;margin:10px 0;font-family:Menlo,'SF Mono',monospace;font-size:11px;color:#0c1e2f;line-height:1.5;word-break:break-all;">npx -y --package=github:blueprintit-ai/shop-os-installer shop-os-install</div>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:12px 0 8px;">When the installer asks for your license key, paste this:</p>
<div style="background:#ede6d4;border-left:3px solid #1c6ea4;padding:14px 16px;margin:8px 0 0;font-family:Menlo,'SF Mono',monospace;font-size:13px;letter-spacing:2px;color:#0c1e2f;text-align:center;font-weight:600;">${safeKey}</div>
</td></tr>

<!-- § 03 Help -->
<tr><td style="padding:28px 0 0;">
<div style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#1c6ea4;border-top:1px solid #1c6ea4;padding-top:14px;margin-bottom:6px;">§ 03 &nbsp;·&nbsp; Need help?</div>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:8px 0 0;">Reply to your welcome email. We will respond ASAP.</p>
</td></tr>

<!-- Signature -->
<tr><td style="padding:32px 0 0;">
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:0;">Welcome aboard.</p>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.5;color:#0c1e2f;margin:18px 0 0;">
<strong style="font-weight:600;">Glenn Chua</strong>, Founder<br/>
Blueprint<em style="font-style:italic;color:#c2461f;font-weight:600;">IT</em>, LLC<br/>
<a href="mailto:glenn@blueprintit.ai" style="color:#1c6ea4;text-decoration:underline;text-underline-offset:2px;">glenn@blueprintit.ai</a><br/>
<a href="https://blueprintit.ai" style="color:#1c6ea4;text-decoration:underline;text-underline-offset:2px;">www.blueprintit.ai</a>
</p>
</td></tr>

<!-- Footer -->
<tr><td style="padding:32px 0 0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
<tr><td style="border-top:1px solid #1c6ea4;height:0;line-height:0;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:14px 0 0;font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#6a7788;">
Blueprint IT &nbsp;·&nbsp; Shop OS Foundation &nbsp;·&nbsp; <a href="https://blueprintit.ai" style="color:#6a7788;text-decoration:none;">blueprintit.ai</a>
</td></tr>
</table>
</td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
