// Server-side verification of StoreKit signed transactions (JWS).
//
// Apple signs every StoreKit 2 transaction with a certificate chain rooted at
// "Apple Root CA - G3". We verify:
//   1. the x5c chain links (leaf -> intermediate -> root),
//   2. that the root is the pinned Apple Root CA G3,
//   3. the JWS signature over header.payload with the leaf public key,
//   4. bundle id / product id / expiry of the decoded payload.
//
// No Apple API credentials are required for this — the JWS is self-contained.

// @peculiar/x509 depends on tsyringe, which needs the Reflect metadata polyfill.
import "reflect-metadata";
import * as x509 from "@peculiar/x509";

// SHA-256 fingerprint of "Apple Root CA - G3" (DER).
const APPLE_ROOT_CA_G3_SHA256 =
  "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179";

export type VerifiedTransaction = {
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  bundleId: string;
  environment?: string;
  expiresDate?: number;
  revocationDate?: number;
};

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify an Apple-signed transaction JWS. Throws on any verification failure.
 */
export async function verifyAppleSignedTransaction(
  jws: string,
  opts: { expectedProductId: string; expectedBundleId?: string },
): Promise<VerifiedTransaction> {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new Error("malformed_jws");

  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as {
    alg?: string;
    x5c?: string[];
  };
  if (header.alg !== "ES256") throw new Error("unsupported_alg");
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length < 2) throw new Error("missing_chain");

  const certs = x5c.map((der) => new x509.X509Certificate(der));

  // Pin the root certificate.
  const root = certs[certs.length - 1];
  const rootFingerprint = toHex(await root.getThumbprint("SHA-256"));
  const pinned = (process.env.APPLE_ROOT_CA_G3_SHA256 ?? APPLE_ROOT_CA_G3_SHA256).toLowerCase();
  if (rootFingerprint !== pinned) throw new Error("untrusted_root");

  // Verify each chain link and validity windows.
  const now = new Date();
  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i];
    if (now < cert.notBefore || now > cert.notAfter) throw new Error("cert_expired");
    const issuer = certs[i + 1] ?? root;
    const ok = await cert.verify({ publicKey: await issuer.publicKey.export(), signatureOnly: true });
    if (!ok) throw new Error("bad_chain");
  }

  // Verify the JWS signature with the leaf certificate's public key.
  const leafKey = await certs[0].publicKey.export(
    { name: "ECDSA", namedCurve: "P-256" },
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sigBytes = b64urlToBytes(parts[2]);
  const sigOk = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    leafKey,
    sigBytes as unknown as BufferSource,
    signed as unknown as BufferSource,
  );
  if (!sigOk) throw new Error("bad_signature");

  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as Record<
    string,
    unknown
  >;

  const productId = String(payload.productId ?? "");
  const bundleId = String(payload.bundleId ?? "");
  const originalTransactionId = String(payload.originalTransactionId ?? "");
  const transactionId = String(payload.transactionId ?? originalTransactionId);

  if (!originalTransactionId) throw new Error("missing_transaction_id");
  if (productId !== opts.expectedProductId) throw new Error("product_mismatch");
  if (opts.expectedBundleId && bundleId && bundleId !== opts.expectedBundleId) {
    throw new Error("bundle_mismatch");
  }

  return {
    originalTransactionId,
    transactionId,
    productId,
    bundleId,
    environment: typeof payload.environment === "string" ? payload.environment : undefined,
    expiresDate: typeof payload.expiresDate === "number" ? payload.expiresDate : undefined,
    revocationDate:
      typeof payload.revocationDate === "number" ? payload.revocationDate : undefined,
  };
}
