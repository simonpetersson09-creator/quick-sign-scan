// Authoritative (server-side) premium entitlement + free-quota bookkeeping.
//
// The client can *display* premium state from StoreKit, but the server never
// trusts it: unlimited sending is only granted when this module finds a
// verified Apple transaction stored for the device.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyAppleSignedTransaction } from "./apple-transaction.server";

export const PREMIUM_PRODUCT_ID = "com.sspp.signandgo.premium.yearly";
export const FREE_DOC_LIMIT = 3;

export type EntitlementRow = {
  device_id: string;
  expires_at: string | null;
  revoked_at: string | null;
};

/** True when the device has a stored, verified, non-expired subscription. */
export async function hasServerPremium(deviceId: string): Promise<boolean> {
  if (!deviceId) return false;
  const { data, error } = await supabaseAdmin
    .from("premium_entitlements")
    .select("device_id, expires_at, revoked_at")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (error) {
    console.error("[entitlement] lookup failed", error.code);
    return false;
  }
  const row = data as EntitlementRow | null;
  if (!row || row.revoked_at) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return false;
  return true;
}

/**
 * Verify an Apple-signed transaction and persist the entitlement for a device.
 * Returns whether the device is premium after the update.
 */
export async function storeVerifiedPurchase(
  deviceId: string,
  signedTransaction: string,
): Promise<{ ok: boolean; active: boolean; reason?: string }> {
  try {
    const tx = await verifyAppleSignedTransaction(signedTransaction, {
      expectedProductId: PREMIUM_PRODUCT_ID,
      expectedBundleId: process.env.APPLE_BUNDLE_ID || undefined,
    });

    const expiresAt = tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null;
    const revokedAt = tx.revocationDate ? new Date(tx.revocationDate).toISOString() : null;
    const active = !revokedAt && (!expiresAt || new Date(expiresAt).getTime() > Date.now());

    const { error } = await supabaseAdmin.from("premium_entitlements").upsert(
      {
        device_id: deviceId,
        original_transaction_id: tx.originalTransactionId,
        product_id: tx.productId,
        environment: tx.environment ?? null,
        expires_at: expiresAt,
        revoked_at: revokedAt,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "device_id" },
    );
    if (error) {
      console.error("[entitlement] upsert failed", error.code);
      return { ok: false, active: false, reason: "storage_error" };
    }
    return { ok: true, active };
  } catch (e) {
    // Only the generic reason is returned to the client.
    console.error("[entitlement] verification failed", e instanceof Error ? e.message : "unknown");
    return { ok: false, active: false, reason: "verification_failed" };
  }
}

/** Server-side free-quota counter. */
export async function getServerSentCount(deviceId: string): Promise<number> {
  if (!deviceId) return 0;
  const { data, error } = await supabaseAdmin
    .from("device_send_usage")
    .select("sent_count")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (error) {
    console.error("[usage] lookup failed", error.code);
    return 0;
  }
  return (data as { sent_count: number } | null)?.sent_count ?? 0;
}

export async function incrementServerSentCount(deviceId: string): Promise<void> {
  if (!deviceId) return;
  // Atomic server-side increment. A read-then-write would let two concurrent
  // sends from the same device write the same value, undercounting usage and
  // allowing the free quota to be exceeded.
  const { error } = await supabaseAdmin.rpc("increment_device_send_usage", {
    _device_id: deviceId,
  });
  if (error) console.error("[usage] increment failed", error.code);
}


/**
 * Authoritative paywall decision. Premium devices are unlimited; everyone else
 * is capped at FREE_DOC_LIMIT sends counted server-side.
 */
export async function canSend(deviceId: string): Promise<{ allowed: boolean; premium: boolean }> {
  const premium = await hasServerPremium(deviceId);
  if (premium) return { allowed: true, premium: true };
  const count = await getServerSentCount(deviceId);
  return { allowed: count < FREE_DOC_LIMIT, premium: false };
}
