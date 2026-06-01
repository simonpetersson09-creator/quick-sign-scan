import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const FROM = "Skannade dokument <noreply@shiningdays.se>";

const inputSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  message: z.string().max(20000),
  filename: z.string().min(1).max(255),
  pdfBase64: z.string().min(1),
  replyTo: z.string().email().optional(),
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const sendScanEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");

    // Approx PDF size (base64 → bytes ≈ length * 0.75)
    const approxBytes = Math.floor((data.pdfBase64.length * 3) / 4);
    const approxMb = (approxBytes / (1024 * 1024)).toFixed(2);
    console.log(
      `[sendScanEmail] PDF size: ~${approxMb} MB (${approxBytes} bytes), to=${data.to}`,
    );
    if (approxBytes > 5 * 1024 * 1024) {
      console.warn(
        `[sendScanEmail] WARNING: PDF is large (~${approxMb} MB). Resend may reject attachments over ~10 MB and delivery may fail.`,
      );
    }

    const body = JSON.stringify({
      from: FROM,
      to: [data.to],
      subject: data.subject,
      text: data.message,
      ...(data.replyTo ? { reply_to: data.replyTo } : {}),
      attachments: [
        {
          filename: data.filename,
          content: data.pdfBase64,
        },
      ],
    });

    const maxAttempts = 3;
    let lastErr: { status: number; body: unknown } | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch(`${GATEWAY_URL}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": RESEND_API_KEY,
        },
        body,
      });

      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        return { ok: true, id: (result as { id?: string }).id ?? null };
      }

      lastErr = { status: response.status, body: result };
      const retryable = response.status === 429 || response.status >= 500;
      console.error(
        `[sendScanEmail] attempt ${attempt}/${maxAttempts} failed: ${response.status}`,
        result,
      );

      if (!retryable || attempt === maxAttempts) break;
      // Backoff: 400ms, 1200ms
      await sleep(attempt === 1 ? 400 : 1200);
    }

    throw new Error(
      `Resend API ${lastErr?.status}: ${JSON.stringify(lastErr?.body)}`,
    );
  });
