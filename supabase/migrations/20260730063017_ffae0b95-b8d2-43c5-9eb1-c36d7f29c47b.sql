CREATE TABLE public.premium_entitlements (
  device_id text PRIMARY KEY,
  original_transaction_id text NOT NULL,
  product_id text NOT NULL,
  environment text,
  expires_at timestamptz,
  revoked_at timestamptz,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.premium_entitlements TO service_role;
ALTER TABLE public.premium_entitlements ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.device_send_usage (
  device_id text PRIMARY KEY,
  sent_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.device_send_usage TO service_role;
ALTER TABLE public.device_send_usage ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_premium_entitlements_original_tx ON public.premium_entitlements (original_transaction_id);