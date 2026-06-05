// Server function used by the web access-code gate to validate a code before
// storing it in localStorage. The real protection is in `sendScanEmail`,
// which checks the same header on every send — this endpoint just gives the
// user immediate feedback instead of failing later at send time.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MAX_CODE_LEN = 256;

const inputSchema = z.object({
  code: z.string().min(1).max(MAX_CODE_LEN),
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const verifyAccessCode = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const r = inputSchema.safeParse(data);
    if (!r.success) throw new Error("invalid_input");
    return r.data;
  })
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const expected = process.env.APP_ACCESS_CODE;
    if (!expected) return { ok: false };
    return { ok: timingSafeEqual(data.code, expected) };
  });
