CREATE TABLE public.app_kv (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_kv TO authenticated;
GRANT ALL ON public.app_kv TO service_role;

ALTER TABLE public.app_kv ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read all app_kv"
  ON public.app_kv FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert app_kv"
  ON public.app_kv FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update app_kv"
  ON public.app_kv FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete app_kv"
  ON public.app_kv FOR DELETE TO authenticated USING (true);

ALTER TABLE public.app_kv REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_kv;