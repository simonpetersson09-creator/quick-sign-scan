import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const FROM = "Skannade dokument <noreply@shiningdays.se>";

// Max attachment payload (base64-encoded). ~10 MB binary ≈ 14 MB base64.
// Resend rejects attachments over ~10 MB, and most inbound mail servers
// reject messages over ~25 MB total — keep us safely under both.
const MAX_PDF_BASE64_LEN = 14_000_000;

export const SendErrorCodes = [
  "attachment_too_large",
  "invalid_recipient",
  "rate_limited",
  "network_error",
  "unauthorized",
  "unknown",
] as const;
export type SendErrorCode = (typeof SendErrorCodes)[number];

export type SendScanEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; code: SendErrorCode; status?: number; detail?: string };

const inputSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  message: z.string().max(20000),
  filename: z.string().min(1).max(255),
  pdfBase64: z
    .string()
    .min(1)
    .max(MAX_PDF_BASE64_LEN, { message: "attachment_too_large" }),
  replyTo: z.string().email().optional(),
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyResendError(
  status: number,
  body: unknown,
): SendErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 413) return "attachment_too_large";
  if (status === 429) return "rate_limited";
  // Resend returns 422 for invalid 'to' addresses, 400 for bad payload.
  if (status === 422 || status === 400) {
    const msg = JSON.stringify(body ?? "").toLowerCase();
    if (msg.includes("attachment") && (msg.includes("size") || msg.includes("large"))) {
      return "attachment_too_large";
    }
    if (msg.includes("to") || msg.includes("recipient") || msg.includes("email")) {
      return "invalid_recipient";
    }
  }
  return "unknown";
}

export const sendScanEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const r = inputSchema.safeParse(data);
    if (!r.success) {
      const firstMsg = r.error.issues[0]?.message ?? "invalid_input";
      // Surface attachment-size violation in the same channel as the
      // runtime errors so the client gets a clean code.
      const e = new Error(firstMsg);
      throw e;
    }
    return r.data;
  })
  .handler(async ({ data }): Promise<SendScanEmailResult> => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) {
      return { ok: false, code: "unauthorized", detail: "LOVABLE_API_KEY missing" };
    }
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      return { ok: false, code: "unauthorized", detail: "RESEND_API_KEY missing" };
    }

    const approxBytes = Math.floor((data.pdfBase64.length * 3) / 4);
    const approxMb = (approxBytes / (1024 * 1024)).toFixed(2);
    console.log(
      `[sendScanEmail] PDF size: ~${approxMb} MB (${approxBytes} bytes), to=${data.to}`,
    );
    if (approxBytes > 5 * 1024 * 1024) {
      console.warn(
        `[sendScanEmail] WARNING: PDF is large (~${approxMb} MB). Resend may reject attachments over ~10 MB.`,
      );
    }

    const body = JSON.stringify({
      from: FROM,
      to: [data.to],
      subject: data.subject,
      text: data.message,
      ...(data.replyTo ? { reply_to: data.replyTo } : {}),
      attachments: [{ filename: data.filename, content: data.pdfBase64 }],
    });

    const maxAttempts = 3;
    let lastStatus: number | undefined;
    let lastBody: unknown = null;
    let lastNetworkError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${GATEWAY_URL}/emails`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
          },
          body,
        });
      } catch (err) {
        // Network-level failure (DNS, TCP reset, abort, TLS, etc.) — retryable.
        lastNetworkError = err;
        console.error(
          `[sendScanEmail] attempt ${attempt}/${maxAttempts} network error:`,
          err,
        );
        if (attempt === maxAttempts) {
          return {
            ok: false,
            code: "network_error",
            detail: err instanceof Error ? err.message : String(err),
          };
        }
        await sleep(attempt === 1 ? 400 : 1200);
        continue;
      }

      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        return { ok: true, id: (result as { id?: string }).id ?? null };
      }

      lastStatus = response.status;
      lastBody = result;
      const retryable = response.status === 429 || response.status >= 500;
      console.error(
        `[sendScanEmail] attempt ${attempt}/${maxAttempts} failed: ${response.status}`,
        result,
      );

      if (!retryable || attempt === maxAttempts) break;
      await sleep(attempt === 1 ? 400 : 1200);
    }

    if (lastStatus === undefined) {
      return {
        ok: false,
        code: "network_error",
        detail:
          lastNetworkError instanceof Error
            ? lastNetworkError.message
            : String(lastNetworkError ?? "unknown"),
      };
    }

    return {
      ok: false,
      code: classifyResendError(lastStatus, lastBody),
      status: lastStatus,
      detail: typeof lastBody === "string" ? lastBody : JSON.stringify(lastBody),
    };
  });
