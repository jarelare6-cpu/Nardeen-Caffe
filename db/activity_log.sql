-- ══════════════════════════════════════════════════════════════
-- v22: activity_log — سجل النشاط (من فعل ماذا ومتى)
-- شغّل هذا الملف مرة واحدة في Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.activity_log (
  id         text PRIMARY KEY,
  action     text NOT NULL DEFAULT '',
  details    text NOT NULL DEFAULT '',
  user_name  text NOT NULL DEFAULT '',
  user_role  text NOT NULL DEFAULT '',
  order_num  text NOT NULL DEFAULT '',
  amount     numeric,
  branch     text NOT NULL DEFAULT 'main',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_created_at_idx
  ON public.activity_log (created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'activity_log' AND policyname = 'activity_log_all'
  ) THEN
    CREATE POLICY activity_log_all ON public.activity_log
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- تفعيل التحديث الفوري (Realtime) للجدول
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
