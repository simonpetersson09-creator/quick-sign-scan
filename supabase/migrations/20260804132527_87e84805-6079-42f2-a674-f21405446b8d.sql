CREATE OR REPLACE FUNCTION public.increment_device_send_usage(_device_id text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.device_send_usage (device_id, sent_count, updated_at)
  VALUES (_device_id, 1, now())
  ON CONFLICT (device_id) DO UPDATE
    SET sent_count = public.device_send_usage.sent_count + 1,
        updated_at = now()
  RETURNING sent_count;
$$;

REVOKE ALL ON FUNCTION public.increment_device_send_usage(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_device_send_usage(text) TO service_role;