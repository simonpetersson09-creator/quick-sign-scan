// Premium subscription state + App Store IAP integration.
//
// On native iOS (Capacitor) this talks to StoreKit via `cordova-plugin-purchase`
// (CdvPurchase, attached to `window` once the plugin's JS is loaded by the
// native shell). On web / SSR, all calls become safe no-ops and `isPremium`
// stays false.
//
// We also cache the last-known active state in localStorage so the UI knows
// the user is Premium offline / before StoreKit finishes its async refresh.

const PRODUCT_ID = "com.sspp.signandgo.premium.yearly";
const CACHE_KEY = "signgo.premium.active.v1";

export type PremiumStatus =
  | { state: "loading" }
  | { state: "unsupported" } // web / non-iOS — IAP not available
  | { state: "inactive"; priceLabel?: string; productLoaded?: boolean }
  | { state: "active"; expiryDate?: Date | null; willRenew?: boolean };


type Listener = (s: PremiumStatus) => void;
const listeners = new Set<Listener>();

let current: PremiumStatus =
  typeof window === "undefined"
    ? { state: "loading" }
    : readCache()
      ? { state: "active" }
      : { state: "loading" };

function readCache(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCache(active: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (active) localStorage.setItem(CACHE_KEY, "1");
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
}

function setStatus(
  next: PremiumStatus,
  opts: { fromReceipt?: boolean } = {},
) {
  // CRITICAL: never downgrade from active → non-active unless we got an
  // explicit verified/unverified signal from StoreKit. Plugin-load timeouts,
  // `unsupported`, transient `store.owned() === false` before the receipt
  // arrives, and Restore-in-progress must NOT wipe the active cache.
  if (current.state === "active" && next.state !== "active" && !opts.fromReceipt) {
    return;
  }
  current = next;
  if (next.state === "active") writeCache(true);
  else if (next.state === "inactive" && opts.fromReceipt) writeCache(false);
  listeners.forEach((l) => l(next));
}

function isNativeIOS(): boolean {
  if (typeof window === "undefined") return false;
  // Capacitor exposes this global; the access-code module uses the same check.
  // Avoid importing it to keep this module zero-dep.
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  return cap?.getPlatform?.() === "ios";
}

// Typed (loose) handle to the cordova-plugin-purchase global.
type CdvStore = {
  register: (products: unknown[]) => void;
  when: () => {
    productUpdated: (cb: (p: CdvProduct) => void) => unknown;
    approved: (cb: (t: CdvTx) => void) => unknown;
    verified: (cb: (r: CdvReceipt) => void) => unknown;
    unverified: (cb: (r: CdvReceipt) => void) => unknown;
    finished: (cb: (t: CdvTx) => void) => unknown;
  };
  error: (cb: (err: { code?: number; message?: string }) => void) => void;
  initialize: (platforms?: unknown[]) => Promise<unknown>;
  update: () => Promise<unknown>;
  restorePurchases: () => Promise<unknown>;
  get: (id: string) => CdvProduct | undefined;
  owned?: (idOrProduct: string | CdvProduct) => boolean;
};
type CdvProduct = {
  id: string;
  owned?: boolean;
  canPurchase?: boolean;
  pricing?: { price?: string };
  getOffer?: () => CdvOffer | undefined;
  offers?: CdvOffer[];
};
type CdvOffer = {
  id?: string;
  canPurchase?: boolean;
  order: () => Promise<CdvStoreError | undefined>;
};
type CdvStoreError = {
  isError?: boolean;
  code?: number;
  message?: string;
  productId?: string | null;
};
type CdvTx = {
  productId?: string;
  products?: Array<{ id: string }>;
  verify: () => Promise<unknown>;
  finish: () => Promise<unknown>;
};
type CdvReceipt = {
  collection?: Array<{
    productId: string;
    isExpired?: boolean;
    expiryDate?: number | string | null;
    willRenew?: boolean;
  }>;
};
type CdvGlobal = {
  ProductType: { PAID_SUBSCRIPTION: string };
  Platform: { APPLE_APPSTORE: string };
  store: CdvStore;
};


function getCdv(): CdvGlobal | null {
  if (typeof window === "undefined") return null;
  const g = (window as unknown as { CdvPurchase?: CdvGlobal }).CdvPurchase;
  return g ?? null;
}

let initStarted = false;

/**
 * Initialize IAP. Safe to call multiple times; only runs once.
 * On non-iOS this immediately transitions to `unsupported`.
 */
export async function initPremium(): Promise<void> {
  if (initStarted) return;
  initStarted = true;

  if (!isNativeIOS()) {
    setStatus({ state: "unsupported" });
    return;
  }

  // Wait briefly for the cordova plugin script to attach the global.
  const cdv = await waitForCdv(8000);
  if (!cdv) {
    console.warn("[premium] CdvPurchase not available — IAP disabled");
    setStatus({ state: "unsupported" });
    return;
  }

  try {
    const { store, ProductType, Platform } = cdv;

    // Surface StoreKit errors. Without this, failures are silent and Apple
    // reviewers just see a generic toast with no diagnostics in the logs.
    store.error((err) => {
      console.error("[premium] store error", err?.code, err?.message);
      if (isCancelledCode(err?.code)) {
        lastStoreError = "cancelled";
        return;
      }
      lastStoreError = storeErrorReason(err, "store_error");
    });

    store.register([
      {
        id: PRODUCT_ID,
        type: ProductType.PAID_SUBSCRIPTION,
        platform: Platform.APPLE_APPSTORE,
      },
    ]);

    type Chain = {
      productUpdated: (cb: (p: CdvProduct) => void) => Chain;
      approved: (cb: (t: CdvTx) => void) => Chain;
      verified: (cb: (r: CdvReceipt) => void) => Chain;
      unverified: (cb: (r: CdvReceipt) => void) => Chain;
      finished: (cb: (t: CdvTx) => void) => Chain;
    };
    const chain = store.when() as unknown as Chain;
    chain
      .productUpdated((p: CdvProduct) => {
        if (p.id === PRODUCT_ID) {
          productLoaded = true;
          refreshFromStore();
        }
      })
      .approved((t: CdvTx) => {
        const txProductId = t.productId ?? t.products?.[0]?.id;
        if (txProductId && txProductId !== PRODUCT_ID) return;
        // No server-side receipt validator is configured for this app, so
        // calling t.verify() would stall forever (the `verified` callback
        // never fires without a validator). Finish the transaction directly
        // and refresh ownership from StoreKit.
        void t
          .finish()
          .catch((e) => console.error("[premium] finish failed", e))
          .finally(() => refreshFromStore());
      })
      .verified((r: CdvReceipt) => {
        applyReceipt(r);
      })
      .unverified(() => {
        setStatus(
          { state: "inactive", priceLabel: getPriceLabel() ?? undefined, productLoaded },
          { fromReceipt: true },
        );
      })
      .finished(() => {
        refreshFromStore();
      });

    await store.initialize([Platform.APPLE_APPSTORE]);
    // Kick a product refresh; productUpdated will fire once StoreKit responds.
    await store.update().catch(() => {});
    refreshFromStore();
  } catch (e) {
    console.error("[premium] init failed", e);
    setStatus({ state: "unsupported" });
  }
}

let productLoaded = false;
let lastStoreError: string | null = null;

function isCancelledCode(code?: number): boolean {
  // cordova-plugin-purchase v13 uses 6777006; older/native paths may surface
  // platform cancellation codes instead.
  return code === 6777006 || code === 6500 || code === 2;
}

function storeErrorReason(err: CdvStoreError | undefined, fallback = "purchase_failed"): string {
  if (!err) return fallback;
  if (isCancelledCode(err.code)) return "cancelled";
  return `${err.message ?? fallback} [${err.code ?? "?"}]`;
}


function waitForCdv(timeoutMs: number): Promise<CdvGlobal | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const g = getCdv();
      if (g) return resolve(g);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 150);
    };
    tick();
  });
}

function applyReceipt(r: CdvReceipt) {
  const entry = r.collection?.find((e) => e.productId === PRODUCT_ID);
  if (!entry) return;
  if (entry.isExpired) {
    setStatus(
      { state: "inactive", priceLabel: getPriceLabel() ?? undefined },
      { fromReceipt: true },
    );
    return;
  }
  const expiry = entry.expiryDate ? new Date(entry.expiryDate) : null;
  setStatus(
    { state: "active", expiryDate: expiry, willRenew: entry.willRenew },
    { fromReceipt: true },
  );
}

function refreshFromStore() {
  const cdv = getCdv();
  if (!cdv) return;
  const product = cdv.store.get(PRODUCT_ID);
  if (product && (product.pricing?.price || product.offers?.length)) {
    productLoaded = true;
  }
  const owned =
    cdv.store.owned?.(PRODUCT_ID) ??
    cdv.store.owned?.(product as CdvProduct) ??
    product?.owned ??
    false;
  if (owned) {
    if (current.state !== "active") setStatus({ state: "active" });
    return;
  }
  if (current.state !== "active") {
    setStatus({
      state: "inactive",
      priceLabel: getPriceLabel() ?? undefined,
      productLoaded,
    });
  }
}


function getPriceLabel(): string | null {
  const cdv = getCdv();
  if (!cdv) return null;
  const product = cdv.store.get(PRODUCT_ID);
  return product?.pricing?.price ?? null;
}

export async function purchasePremium(): Promise<{ ok: boolean; reason?: string }> {
  const cdv = getCdv();
  if (!cdv) return { ok: false, reason: "unsupported" };

  // Wait briefly for the product to finish loading from the App Store.
  // On a fresh sandbox account (Apple review) the product list can take a
  // couple of seconds. Tapping before it arrives previously returned a
  // generic "purchase_failed" toast.
  const product = await waitForProduct(6000);
  if (!product) {
    return {
      ok: false,
      reason: lastStoreError ?? "product_not_loaded",
    };
  }

  try {
    const offer = product.getOffer?.() ?? product.offers?.[0];
    if (!offer) return { ok: false, reason: "no_offer" };
    if (offer.canPurchase === false || product.canPurchase === false) {
      return { ok: false, reason: "not_allowed" };
    }
    lastStoreError = null;
    const orderError = await offer.order();
    if (orderError?.isError || orderError?.code) {
      const reason = storeErrorReason(orderError);
      return { ok: false, reason };
    }
    // If StoreKit reported an async error (e.g. cancel) during order(),
    // surface that instead of pretending success.
    if (lastStoreError === "cancelled") return { ok: false, reason: "cancelled" };
    if (lastStoreError) return { ok: false, reason: lastStoreError };
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[premium] purchase failed", msg);
    if (lastStoreError === "cancelled") return { ok: false, reason: "cancelled" };
    return { ok: false, reason: lastStoreError ?? msg };
  }
}

function waitForProduct(timeoutMs: number): Promise<CdvProduct | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const cdv = getCdv();
      const p = cdv?.store.get(PRODUCT_ID);
      if (p && (p.pricing?.price || p.offers?.length)) return resolve(p);
      if (Date.now() - start > timeoutMs) return resolve(p ?? null);
      setTimeout(tick, 200);
    };
    tick();
  });
}

export function isProductLoaded(): boolean {
  return productLoaded;
}


export async function restorePremium(): Promise<{ ok: boolean; active: boolean }> {
  const cdv = getCdv();
  if (!cdv) return { ok: false, active: false };
  try {
    await cdv.store.restorePurchases();
    await cdv.store.update().catch(() => {});
    refreshFromStore();
    return { ok: true, active: current.state === "active" };
  } catch (e) {
    console.error("[premium] restore failed", e);
    return { ok: false, active: current.state === "active" };
  }
}

export function getPremiumStatus(): PremiumStatus {
  return current;
}

export function isPremiumActive(): boolean {
  return current.state === "active";
}

export function subscribePremium(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const PREMIUM_PRODUCT_ID = PRODUCT_ID;
