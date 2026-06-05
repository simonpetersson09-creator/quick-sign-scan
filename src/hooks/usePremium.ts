import { useEffect, useState } from "react";
import {
  getPremiumStatus,
  initPremium,
  isPremiumActive,
  subscribePremium,
  type PremiumStatus,
} from "@/lib/premium";
import { FREE_DOC_LIMIT, initUsage, usage } from "@/lib/usage";

export function usePremium() {
  const [status, setStatus] = useState<PremiumStatus>(() => getPremiumStatus());

  useEffect(() => {
    void initPremium();
    return subscribePremium(setStatus);
  }, []);

  return status;
}

export function useUsage() {
  const [count, setCount] = useState<number>(() => usage.getSentCount());
  useEffect(() => {
    void initUsage().then(() => setCount(usage.getSentCount()));
    const unsub = usage.subscribe(setCount);
    return () => {
      unsub();
    };
  }, []);
  return {
    sent: count,
    remaining: Math.max(0, FREE_DOC_LIMIT - count),
    limit: FREE_DOC_LIMIT,
  };
}

/** True if the user must purchase before sending another document. */
export function useNeedsPaywall() {
  const status = usePremium();
  const { remaining } = useUsage();
  if (status.state === "active") return false;
  return remaining <= 0;
}

export { isPremiumActive };
