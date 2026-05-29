import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

const inputSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  message: z.string().max(20000),
  filename: z.string().min(1).max(255),
  pdfBase64: z.string().min(1),
  from: z.string().optional(),
});

export const sendScanEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");

    const from = data.from || "Skannade dokument <noreply@shiningdays.se>";

    const response = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from,
        to: [data.to],
        subject: data.subject,
        text: data.message,
        attachments: [
          {
            filename: data.filename,
            content: data.pdfBase64,
          },
        ],
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `Resend API ${response.status}: ${JSON.stringify(result)}`,
      );
    }
    return { ok: true, id: (result as { id?: string }).id ?? null };
  });
