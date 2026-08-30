export interface WelcomeTemplateInput {
  customerName: string;
  licenseKey: string;
  pdfUrl: string;
  bookingUrl: string;
  installUrl: string;
}

export function welcomeSubject(): string {
  return "Welcome to Shop OS, your license key and next steps";
}

export function welcomeText(input: WelcomeTemplateInput): string {
  return `Hi ${input.customerName},

Your Shop OS Foundation license key is below, along with the onboarding
hour we run together and the short list of things to have ready before
it.


YOUR LICENSE KEY
${"─".repeat(60)}

    ${input.licenseKey}

Save it somewhere safe (a password manager, a folder in your inbox). We
enter it for you during the call and you will not be asked for it again. Keep this email so you can find the key later. It is also
embedded in the attached PDF.


BOOK YOUR ONBOARDING HOUR
${"─".repeat(60)}

Shop OS is set up with you, not by you. One booking, one hour, two
halves:

  First 30 minutes, setup. We get on a screen share and set Shop OS up on
  your machine: every prerequisite, your license, and your Shop OS Vault
  in the folder you choose. By the halfway mark you have a working Shop
  Brain.

  Second 30 minutes, training. We walk you and whoever else should be in
  the room through running it day to day.

Pick your time here (look for "Shop OS Foundation Setup"):

    ${input.bookingUrl}

One booking covers both halves. Pick an hour when you will not be pulled
onto the floor.


INSTALL IT YOURSELF (OPTIONAL)
${"─".repeat(60)}

Prefer to get hands-on before the call? Your personal install page is
ready. The installer it gives you already carries your license key, so
there is nothing to type:

    ${input.installUrl}

Pick Mac or Windows on that page, download your installer, and
double-click it. If anything gets stuck, stop there and bring it to
your booked hour: we finish it together. Self-installing does not use
up your setup and training session, and we still recommend booking it.


BEFORE THE CALL
${"─".repeat(60)}

Five minutes of prep, so we spend the call on your business instead of
on downloads:

  1. A Claude subscription. Shop OS runs on Claude. If you do not have an
     account yet, set one up at https://claude.ai/onboarding and have the
     login handy.

  2. Your computer login password. The install asks for it partway
     through. If someone else administers the machine, get them on the
     call with us.

  3. A decision on where the vault should live. Your home folder,
     Documents, or Desktop if you work on one computer. Inside Dropbox,
     iCloud Drive, or OneDrive if you want it synced across machines.

  4. Thirty uninterrupted minutes on the computer you actually work on,
     with the license key above within reach.


FOR THE SECOND HALF
${"─".repeat(60)}

  1. Decide who should be in the room for the training half. Anyone who
     answers the same questions all day belongs on this call.

  2. Pull together real material to seed the vault: past quotes, a few
     email threads, SOPs, supplier price lists. We use your own documents
     during the session rather than a demo set.

  3. Bring the three questions your team asks you most. We answer them
     out of your own vault before the call ends.


NEED HELP?
${"─".repeat(60)}

Reply to this email. We will respond ASAP.

The attached PDF covers the same ground and is yours to keep. You can
also re-download it any time from:

    ${input.pdfUrl}

Welcome aboard.

Blueprint.ai
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
  const safeBooking = escapeAttr(input.bookingUrl);
  const bookingLabel = escapeHtml(input.bookingUrl);
  const safeInstall = escapeAttr(input.installUrl);
  const installLabel = escapeHtml(input.installUrl);

  // Palette (matches blueprintit.ai/shop-ossi):
  //   paper #f4efe3, paper-2 #ede6d4, paper-line #d9ceb0
  //   ink #0c1e2f, ink-soft #2a3f55, ink-mute #6a7788
  //   cyan #1c6ea4, rust #c2461f

  const p = `font-family:Georgia,serif;font-size:15px;line-height:1.55;color:#0c1e2f;`;
  const marker = `font-family:Menlo,'SF Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:2.2px;color:#1c6ea4;border-top:1px solid #1c6ea4;padding-top:14px;margin-bottom:6px;`;

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
<div style="font-family:Menlo,'SF Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:2.4px;color:#1c6ea4;margin-top:8px;">Your license, your onboarding hour, and how to prepare</div>
</td></tr>

<!-- Greeting -->
<tr><td style="padding:22px 0 0;">
<p style="${p}margin:0 0 12px;">Hi ${safeName},</p>
<p style="${p}margin:0 0 4px;">Your <em style="font-style:italic;color:#1c6ea4;">Shop OS Foundation</em> license key is below, along with the onboarding hour we run together and the short list of things to have ready before it.</p>
</td></tr>

<!-- § 01 License key -->
<tr><td style="padding:28px 0 0;">
<div style="${marker}">§ 01 &nbsp;·&nbsp; Your license key</div>
<div style="background:#ede6d4;border-left:3px solid #1c6ea4;padding:16px 18px;margin:12px 0 10px;font-family:Menlo,'SF Mono',monospace;font-size:16px;letter-spacing:0.08em;color:#0c1e2f;font-weight:600;word-break:break-all;">${safeKey}</div>
<p style="${p}margin:8px 0 8px;">Save it somewhere safe (a password manager, a folder in your inbox). We enter it for you during the call and you will not be asked for it again.</p>
<p style="font-family:Georgia,serif;font-size:13px;line-height:1.55;color:#2a3f55;margin:10px 0 0;font-style:italic;">Keep this email so you can find the key later. It is also embedded in the attached PDF.</p>
</td></tr>

<!-- § 02 Book the sessions -->
<tr><td style="padding:28px 0 0;">
<div style="${marker}">§ 02 &nbsp;·&nbsp; Book your onboarding hour</div>
<p style="${p}margin:8px 0 12px;">Shop OS is set up <em style="font-style:italic;">with</em> you, not by you. One booking, one hour, two halves:</p>
<p style="${p}margin:0 0 10px;"><strong>First 30 minutes, setup.</strong> We get on a screen share and set Shop OS up on your machine: every prerequisite, your license, and your Shop OS Vault in the folder you choose. By the halfway mark you have a working Shop Brain.</p>
<p style="${p}margin:0 0 14px;"><strong>Second 30 minutes, training.</strong> We walk you and whoever else should be in the room through running it day to day.</p>
<p style="${p}margin:0 0 8px;"><a href="${safeBooking}" style="color:#1c6ea4;text-decoration:underline;text-underline-offset:2px;font-weight:600;">Pick your time here</a> &nbsp;&mdash;&nbsp; <span style="font-family:Menlo,'SF Mono',monospace;font-size:11px;word-break:break-all;">${bookingLabel}</span></p>
<p style="font-family:Georgia,serif;font-size:13px;line-height:1.55;color:#2a3f55;margin:10px 0 0;font-style:italic;">Look for &ldquo;Shop OS Foundation Setup&rdquo;. One booking covers both halves. Pick an hour when you will not be pulled onto the floor.</p>
</td></tr>

<!-- § 03 Self install (optional) -->
<tr><td style="padding:28px 0 0;">
<div style="${marker}">§ 03 &nbsp;·&nbsp; Install it yourself (optional)</div>
<p style="${p}margin:8px 0 12px;">Prefer to get hands-on before the call? Your personal install page is ready. The installer it gives you already carries your license key, so there is nothing to type.</p>
<p style="${p}margin:0 0 8px;"><a href="${safeInstall}" style="color:#1c6ea4;text-decoration:underline;text-underline-offset:2px;font-weight:600;">Open your install page</a> &nbsp;&mdash;&nbsp; <span style="font-family:Menlo,'SF Mono',monospace;font-size:11px;word-break:break-all;">${installLabel}</span></p>
<p style="font-family:Georgia,serif;font-size:13px;line-height:1.55;color:#2a3f55;margin:10px 0 0;font-style:italic;">Pick Mac or Windows, download, double-click. If anything gets stuck, stop there and bring it to your booked hour: we finish it together. Self-installing does not use up your setup and training session.</p>
</td></tr>

<!-- § 04 Before setup -->
<tr><td style="padding:28px 0 0;">
<div style="${marker}">§ 04 &nbsp;·&nbsp; Before the call</div>
<p style="${p}margin:8px 0 8px;">Five minutes of prep, so we spend the call on your business instead of on downloads:</p>
<ol style="${p}margin:8px 0 12px 24px;padding:0;">
<li style="margin:0 0 8px;"><strong>A Claude subscription.</strong> Shop OS runs on Claude. If you do not have an account yet, set one up at <a href="https://claude.ai/onboarding" style="color:#1c6ea4;text-decoration:underline;text-underline-offset:2px;">claude.ai/onboarding</a> and have the login handy.</li>
<li style="margin:0 0 8px;"><strong>Your computer login password.</strong> The install asks for it partway through. If someone else administers the machine, get them on the call with us.</li>
<li style="margin:0 0 8px;"><strong>A decision on where the vault should live.</strong> Your home folder, Documents, or Desktop if you work on one computer. Inside Dropbox, iCloud Drive, or OneDrive if you want it synced across machines.</li>
<li style="margin:0 0 8px;"><strong>Thirty uninterrupted minutes</strong> on the computer you actually work on, with the license key from § 01 within reach.</li>
</ol>
</td></tr>

<!-- § 05 Before training -->
<tr><td style="padding:28px 0 0;">
<div style="${marker}">§ 05 &nbsp;·&nbsp; For the second half</div>
<ol style="${p}margin:8px 0 12px 24px;padding:0;">
<li style="margin:0 0 8px;"><strong>Decide who should be in the room for the training half.</strong> Anyone who answers the same questions all day belongs on this call.</li>
<li style="margin:0 0 8px;"><strong>Pull together real material to seed the vault:</strong> past quotes, a few email threads, SOPs, supplier price lists. We use your own documents during the session rather than a demo set.</li>
<li style="margin:0 0 8px;"><strong>Bring the three questions your team asks you most.</strong> We answer them out of your own vault before the call ends.</li>
</ol>
</td></tr>

<!-- § 06 Help -->
<tr><td style="padding:28px 0 0;">
<div style="${marker}">§ 06 &nbsp;·&nbsp; Need help?</div>
<p style="${p}margin:8px 0 8px;">Reply to this email. We will respond ASAP.</p>
<p style="${p}margin:0;">The attached PDF covers the same ground and is yours to keep. You can also <a href="${safeUrl}" style="color:#1c6ea4;text-decoration:underline;text-underline-offset:2px;">re-download it any time</a>.</p>
</td></tr>

<!-- Signature -->
<tr><td style="padding:32px 0 0;">
<p style="${p}margin:0;">Welcome aboard.</p>
<p style="font-family:Georgia,serif;font-size:15px;line-height:1.5;color:#0c1e2f;margin:18px 0 0;">
<strong style="font-weight:600;">Blueprint.ai</strong><br/>
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
