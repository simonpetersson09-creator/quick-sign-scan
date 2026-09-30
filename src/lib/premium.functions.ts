import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Device ids are 128-bit random values generated on-device and act as an
// unguessable per-device secret; reject anything else so callers cannot probe
// short or chosen ids.
const deviceIdSchema = z.string().trim().regex(/^[a-f0-9]{32}$/);

const schema = z.object({
  deviceId: deviceIdSchema,
  signedTransaction: z.string().min(50).max(20000),
});

const statusSchema = z.object({
  deviceId: deviceIdSchema,
});

/**
 * Verify an Apple-signed StoreKit transaction server-side and persist the
 * resulting entitlement. This is the ONLY way a device becomes premium as far
 * as the backend is concerned.
 */
export const verifyPremiumPurchase = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data }): Promise<{ ok: boolean; active: boolean; reason?: string }> => {
    const { storeVerifiedPurchase } = await import("./entitlement.server");
    return storeVerifiedPurchase(data.deviceId, data.signedTransaction);
  });

/** Read the authoritative premium state for a device. */
export const getPremiumEntitlement = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => statusSchema.parse(data))
  .handler(async ({ data }): Promise<{ active: boolean }> => {
    const { hasServerPremium } = await import("./entitlement.server");
    return { active: await hasServerPremium(data.deviceId) };
  });
