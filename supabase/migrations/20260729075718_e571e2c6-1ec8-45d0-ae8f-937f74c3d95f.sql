CREATE TABLE public.email_send_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error_code TEXT,
  recipient_hash TEXT
);

CREATE INDEX email_send_events_created_at_idx ON public.email_send_events (created_at DESC);

GRANT ALL ON public.email_send_events TO service_role;

ALTER TABLE public.email_send_events ENABLE ROW LEVEL SECURITY;