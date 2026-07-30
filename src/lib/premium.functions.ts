import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const schema = z.object({
  deviceId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  signedTransaction: z.string().min(50).max(20000),
});

const statusSchema = z.object({
  deviceId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
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
