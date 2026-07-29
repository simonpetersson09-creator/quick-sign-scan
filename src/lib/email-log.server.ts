// Server-only helper that records one row per email send attempt.
// Stores no PDF, no subject and no plaintext recipient — only a truncated
// salted hash so volume can be measured without keeping personal data.

async function hashRecipient(email: string): Promise<string | null> {
  try {
    const salt = process.env.EMAIL_HASH_SALT ?? "sendScanEmail:recipient:v1";
    const data = new TextEncoder().encode(`${salt}|${email.trim().toLowerCase()}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < 12; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
  } catch {
    return null;
  }
}

export async function logEmailEvent(opts: {
  status: "sent" | "failed";
  errorCode?: string | null;
  recipient?: string | null;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const recipient_hash = opts.recipient ? await hashRecipient(opts.recipient) : null;
    await supabaseAdmin.from("email_send_events").insert({
      status: opts.status,
      error_code: opts.errorCode ?? null,
      recipient_hash,
    });
  } catch (e) {
    // Logging must never break sending.
    console.error(`[emailLog] failed err=${e instanceof Error ? e.name : "unknown"}`);
  }
}
