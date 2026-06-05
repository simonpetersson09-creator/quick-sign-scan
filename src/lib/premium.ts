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
  | { state: "inactive"; priceLabel?: string }
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

function setStatus(next: PremiumStatus) {
  current = next;
  if (next.state === "active") writeCache(true);
  else if (next.state === "inactive") writeCache(false);
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
    approved: (cb: (t: CdvTx) => void) => unknown;
    verified: (cb: (r: CdvReceipt) => void) => unknown;
    unverified: (cb: (r: CdvReceipt) => void) => unknown;
    finished: (cb: (t: CdvTx) => void) => unknown;
  };
  initialize: (platforms?: unknown[]) => Promise<unknown>;
  update: () => Promise<unknown>;
  restorePurchases: () => Promise<unknown>;
  get: (id: string) => CdvProduct | undefined;
  owned?: (idOrProduct: string | CdvProduct) => boolean;
};
type CdvProduct = {
  id: string;
  owned?: boolean;
  pricing?: { price?: string };
  getOffer?: () => { order: () => Promise<unknown> } | undefined;
  offers?: Array<{ order: () => Promise<unknown> }>;
};
type CdvTx = {
  productId?: string;
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

    store.register([
      {
        id: PRODUCT_ID,
        type: ProductType.PAID_SUBSCRIPTION,
        platform: Platform.APPLE_APPSTORE,
      },
    ]);

    type Chain = {
      approved: (cb: (t: CdvTx) => void) => Chain;
      verified: (cb: (r: CdvReceipt) => void) => Chain;
      unverified: (cb: (r: CdvReceipt) => void) => Chain;
      finished: (cb: (t: CdvTx) => void) => Chain;
    };
    const chain = store.when() as unknown as Chain;
    chain
      .approved((t: CdvTx) => {
        void t.verify();
      })
      .verified((r: CdvReceipt) => {
        applyReceipt(r);
      })
      .unverified(() => {
        // Treat unverified as inactive; user can try Restore.
      })
      .finished(() => {
        refreshFromStore();
      });

    await store.initialize([Platform.APPLE_APPSTORE]);
    refreshFromStore();
  } catch (e) {
    console.error("[premium] init failed", e);
    setStatus({ state: "unsupported" });
  }
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
    setStatus({ state: "inactive", priceLabel: getPriceLabel() ?? undefined });
    return;
  }
  const expiry = entry.expiryDate ? new Date(entry.expiryDate) : null;
  setStatus({ state: "active", expiryDate: expiry, willRenew: entry.willRenew });
}

function refreshFromStore() {
  const cdv = getCdv();
  if (!cdv) return;
  const product = cdv.store.get(PRODUCT_ID);
  const owned =
    cdv.store.owned?.(PRODUCT_ID) ??
    cdv.store.owned?.(product as CdvProduct) ??
    product?.owned ??
    false;
  if (owned) {
    if (current.state !== "active") setStatus({ state: "active" });
  } else {
    setStatus({ state: "inactive", priceLabel: getPriceLabel() ?? undefined });
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
  const product = cdv.store.get(PRODUCT_ID);
  if (!product) return { ok: false, reason: "product_not_loaded" };
  try {
    const offer = product.getOffer?.() ?? product.offers?.[0];
    if (!offer) return { ok: false, reason: "no_offer" };
    await offer.order();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[premium] purchase failed", msg);
    return { ok: false, reason: msg };
  }
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
