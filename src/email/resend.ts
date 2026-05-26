import { welcomeText, welcomeHtml, welcomeSubject, WelcomeTemplateInput } from "./welcome-template";

export interface ResendSendInput extends WelcomeTemplateInput {
  to: string;
  fromName?: string;
  fromAddress?: string;
  attachmentBase64?: string;     // base64 PDF
  attachmentFilename?: string;   // e.g. "shop-os-welcome.pdf"
}

export interface ResendResponse {
  id?: string;
  error?: { message?: string };
}

const RESEND_URL = "https://api.resend.com/emails";

export async function sendWelcomeEmail(
  apiKey: string,
  input: ResendSendInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ResendResponse> {
  const from = `${input.fromName ?? "Glenn Chua"} <${input.fromAddress ?? "glenn@blueprintit.ai"}>`;
  const body: Record<string, unknown> = {
    from,
    to: input.to,
    subject: welcomeSubject(),
    html: welcomeHtml(input),
    text: welcomeText(input),
    reply_to: input.fromAddress ?? "glenn@blueprintit.ai",
  };
  if (input.attachmentBase64 && input.attachmentFilename) {
    body.attachments = [
      { filename: input.attachmentFilename, content: input.attachmentBase64 },
    ];
  }
  const resp = await fetchImpl(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data: ResendResponse;
  try { data = JSON.parse(text); } catch { data = { error: { message: text } }; }
  if (!resp.ok) {
    return { error: { message: data.error?.message ?? `Resend ${resp.status}` } };
  }
  return data;
}
