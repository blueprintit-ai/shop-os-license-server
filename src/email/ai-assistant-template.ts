export interface AiAssistantTemplateInput {
  customerName: string;
  bookingUrl: string;
}

export function aiAssistantSubject(): string {
  return "Your AI Assistant, let's schedule the setup";
}

export function aiAssistantText(input: AiAssistantTemplateInput): string {
  return `Hi ${input.customerName},

Thanks for picking up the AI Assistant. It's a customized implementation of
Hermes Agent (by Nous Research), configured and hardened for shop use. First
step is a short setup call to wire it into your business:

    ${input.bookingUrl}

Before the call, please have ready:
  - An OpenRouter account, funded with $50 to start
  - A Hostinger account (any plan, $8-$24.49/mo) to host the assistant
  - The one email address and one calendar you want it integrated with

On the call we'll finish the install, wire up your email and calendar, and
run through 30 minutes of training so your team knows how to use it.

Talk soon.

Glenn Chua, Founder
Blueprint IT, LLC
glenn@blueprintit.ai
www.blueprintit.ai
`;
}

// Visual brand language matches blueprintit.ai and the other transactional
// emails: warm paper background, cyan + rust accents, italic rust "IT"
// wordmark, cyan section rules, monospace section markers. All CSS inline.
export function aiAssistantHtml(input: AiAssistantTemplateInput): string {
  const safeName = escapeHtml(input.customerName);
  const safeUrl = escapeAttr(input.bookingUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your AI Assistant</title>
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
<td align="right" style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:1.4px;color:#1c6ea4;white-space:nowrap;">DOC § AI-ASSISTANT-01</td>
</tr>
</table>
</td></tr>

<!-- Title + tagline -->
<tr><td style="padding:24px 0 4px;">
<h1 style="font-family:Georgia,serif;font-size:28px;font-weight:600;margin:0;color:#0c1e2f;letter-spacing:-0.01em;line-height:1.1;">Your AI Assistant is on the way</h1>
<div style="font-family:Menlo,'SF Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:2.4px;color:#1c6ea4;margin-top:8px;">A dedicated assistant for your shop, running around the clock</div>
</td></tr>

<!-- Greeting -->
<tr><td style="padding:22px 0 0;">
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:0 0 12px;">Hi ${safeName},</p>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:0 0 4px;">Thanks for picking up the AI Assistant. It's a customized implementation of Hermes Agent (by Nous Research), configured and hardened for shop use. First step is a short setup call.</p>
</td></tr>

<!-- § 01 Book the setup call -->
<tr><td style="padding:28px 0 0;">
<div style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#1c6ea4;border-top:1px solid #1c6ea4;padding-top:14px;margin-bottom:6px;">§ 01 &nbsp;·&nbsp; Book your setup call</div>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:8px 0 16px;">Pick a time that works and we'll finish the install together:</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px;">
<tr><td style="background:#1c6ea4;border-radius:2px;">
<a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-family:Menlo,'SF Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#f4efe3;text-decoration:none;font-weight:600;">Book the setup call &rarr;</a>
</td></tr>
</table>
<p style="font-family:Georgia,serif;font-size:13px;line-height:1.55;color:#2a3f55;margin:8px 0 0;font-style:italic;">If the button does not work, paste this URL into your browser: <a href="${safeUrl}" style="color:#1c6ea4;text-decoration:underline;text-underline-offset:2px;font-style:normal;">${safeUrl}</a></p>
</td></tr>

<!-- § 02 Have ready before the call -->
<tr><td style="padding:28px 0 0;">
<div style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#1c6ea4;border-top:1px solid #1c6ea4;padding-top:14px;margin-bottom:6px;">§ 02 &nbsp;·&nbsp; Have ready before the call</div>
<ul style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:8px 0 12px 24px;padding:0;">
<li style="margin:0 0 6px;">An OpenRouter account, funded with $50 to start</li>
<li style="margin:0 0 6px;">A Hostinger account (any plan, $8&ndash;$24.49/mo) to host the assistant</li>
<li style="margin:0 0 6px;">The one email address and one calendar you want it integrated with</li>
</ul>
</td></tr>

<!-- § 03 What happens on the call -->
<tr><td style="padding:28px 0 0;">
<div style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#1c6ea4;border-top:1px solid #1c6ea4;padding-top:14px;margin-bottom:6px;">§ 03 &nbsp;·&nbsp; What happens on the call</div>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:8px 0 8px;">We finish the install, wire up your email and calendar integration, and run through 30 minutes of training so your team knows how to use the assistant day to day.</p>
</td></tr>

<!-- Signature -->
<tr><td style="padding:32px 0 0;">
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:0;">Talk soon.</p>
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
Blueprint IT &nbsp;·&nbsp; AI Assistant &nbsp;·&nbsp; <a href="https://blueprintit.ai" style="color:#6a7788;text-decoration:none;">blueprintit.ai</a>
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
  return s.replace(/[&<>"\']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
