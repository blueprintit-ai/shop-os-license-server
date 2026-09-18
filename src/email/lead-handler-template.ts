export interface LeadHandlerTemplateInput {
  customerName: string;
  bookingUrl: string;
}

export function leadHandlerSubject(): string {
  return "Your Automated Lead Handler, let's schedule the install";
}

export function leadHandlerText(input: LeadHandlerTemplateInput): string {
  return `Hi ${input.customerName},

Thanks for picking up the Automated Lead Handler. It's a done-for-you
install: we set everything up, you approve AI-drafted replies from your
phone. First step is a short kickoff call to wire it into your business:

    ${input.bookingUrl}

What we'll cover on the call:
  - Where your leads come from (website form, Google Sheets, Facebook Lead Ads)
  - The email account replies should send from (Gmail or SMTP)
  - Getting Telegram on your phone for one-tap approvals
  - Your business voice, so the AI drafts sound like you

After the call we handle the full install and you'll approve your first
AI-drafted reply within days, not weeks.

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
export function leadHandlerHtml(input: LeadHandlerTemplateInput): string {
  const safeName = escapeHtml(input.customerName);
  const safeUrl = escapeAttr(input.bookingUrl);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Automated Lead Handler</title>
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
<td align="right" style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:1.4px;color:#1c6ea4;white-space:nowrap;">DOC § LEAD-HANDLER-01</td>
</tr>
</table>
</td></tr>

<!-- Title + tagline -->
<tr><td style="padding:24px 0 4px;">
<h1 style="font-family:Georgia,serif;font-size:28px;font-weight:600;margin:0;color:#0c1e2f;letter-spacing:-0.01em;line-height:1.1;">Your Lead Handler is on the way</h1>
<div style="font-family:Menlo,'SF Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:2.4px;color:#1c6ea4;margin-top:8px;">Every lead answered in minutes, not days</div>
</td></tr>

<!-- Greeting -->
<tr><td style="padding:22px 0 0;">
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:0 0 12px;">Hi ${safeName},</p>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:0 0 4px;">Thanks for picking up the Automated Lead Handler. It's a done-for-you install: we set everything up, you approve AI-drafted replies from your phone. First step is a short kickoff call.</p>
</td></tr>

<!-- § 01 Book the install call -->
<tr><td style="padding:28px 0 0;">
<div style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#1c6ea4;border-top:1px solid #1c6ea4;padding-top:14px;margin-bottom:6px;">§ 01 &nbsp;·&nbsp; Book your install call</div>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:8px 0 16px;">Pick a time that works and we'll wire the Lead Handler into your business:</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px;">
<tr><td style="background:#1c6ea4;border-radius:2px;">
<a href="${safeUrl}" style="display:inline-block;padding:14px 24px;font-family:Menlo,'SF Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#f4efe3;text-decoration:none;font-weight:600;">Book the install call &rarr;</a>
</td></tr>
</table>
<p style="font-family:Georgia,serif;font-size:13px;line-height:1.55;color:#2a3f55;margin:8px 0 0;font-style:italic;">If the button does not work, paste this URL into your browser: <a href="${safeUrl}" style="color:#1c6ea4;text-decoration:underline;text-underline-offset:2px;font-style:normal;">${safeUrl}</a></p>
</td></tr>

<!-- § 02 What we cover -->
<tr><td style="padding:28px 0 0;">
<div style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#1c6ea4;border-top:1px solid #1c6ea4;padding-top:14px;margin-bottom:6px;">§ 02 &nbsp;·&nbsp; What we cover on the call</div>
<ul style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:8px 0 12px 24px;padding:0;">
<li style="margin:0 0 6px;">Where your leads come from — website form, Google Sheets, Facebook Lead Ads</li>
<li style="margin:0 0 6px;">The email account replies should send from (Gmail or SMTP)</li>
<li style="margin:0 0 6px;">Getting Telegram on your phone for one-tap approvals</li>
<li style="margin:0 0 6px;">Your business voice, so the AI drafts sound like you</li>
</ul>
</td></tr>

<!-- § 03 What happens next -->
<tr><td style="padding:28px 0 0;">
<div style="font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#1c6ea4;border-top:1px solid #1c6ea4;padding-top:14px;margin-bottom:6px;">§ 03 &nbsp;·&nbsp; What happens next</div>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;margin:8px 0 8px;">After the call we handle the full install — lead capture, AI drafting, Telegram approvals, open and click tracking. You'll approve your first AI-drafted reply within days, not weeks.</p>
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
Blueprint IT &nbsp;·&nbsp; Automated Lead Handler &nbsp;·&nbsp; <a href="https://blueprintit.ai" style="color:#6a7788;text-decoration:none;">blueprintit.ai</a>
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
