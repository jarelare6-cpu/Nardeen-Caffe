-- ════════════════════════════════════════════════════════════════════════
-- Nardeen Caffe — هجرة v47.2 : قفل إرسال التقارير (منع التكرار بين الأجهزة)
-- نفّذها مرة واحدة في Supabase ▸ SQL Editor. آمنة لإعادة التنفيذ.
--
-- المشكلة التي تحلّها:
--   شبكة أمان الجرد اليومي تعمل على كل جهاز أدمن/كاشير. كان المنع الوحيد
--   للتكرار هو حقل settings.lastDailySent، وهو ليس قفلاً بل ملاحظة:
--     • جهازان ينبضان في النافذة نفسها ⇒ كلاهما يرى الختم قديماً ⇒ رسالتان.
--     • app_settings صفٌّ واحد تكتبه كل الأجهزة؛ أي حفظ إعدادٍ آخر يمحو
--       الختم بقاعدة «آخر كتابة تفوز» ⇒ يعود الإرسال بعد أن استقرّ.
--   النتيجة عملياً: أربع رسائل لجرد اليوم نفسه.
--
-- الحل: الحجز الذرّي. معرّف التقرير هو المفتاح الأساسي، وأول جهاز يُدرج
-- الصف يفوز بالإرسال؛ البقية يصطدمون بخطأ المفتاح المكرر (23505) ويصمتون.
-- القاعدة هي الحَكَم لا التطبيق — فيستحيل التكرار مهما تعدّدت الأجهزة.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.report_log (
  id        TEXT PRIMARY KEY,   -- 'daily:...' | 'weekly:...' | 'shift:...'
  kind      TEXT NOT NULL,      -- daily | weekly | shift
  day_key   TEXT,
  sent_at   TIMESTAMPTZ DEFAULT NOW(),
  sent_by   TEXT DEFAULT '',    -- اسم المستخدم على الجهاز الذي فاز بالحجز
  device    TEXT DEFAULT '',    -- معرّف الجهاز — يكشف أي جهاز يرسل فعلاً
  meta      JSONB
);

CREATE INDEX IF NOT EXISTS idx_report_log_kind_day ON public.report_log(kind, day_key DESC);

ALTER TABLE public.report_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_log_all ON public.report_log;
CREATE POLICY report_log_all ON public.report_log FOR ALL USING (true) WITH CHECK (true);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- ردم أثر رجعي: اعتبر كل يوم أُرسل جرده سابقاً محجوزاً، حتى لا تُعيد
-- شبكة الأمان إرسال الأيام التي وصلتك بالفعل بعد تنفيذ هذه الهجرة.
-- يعتمد على settings.lastDailySent الحالي: كل يوم ≤ الختم يُسجَّل محجوزاً
-- (نأخذ آخر 60 يوماً — أكثر من نافذة التصريف بكثير).
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO public.report_log (id, kind, day_key, sent_by, device)
SELECT 'daily:' || to_char(d, 'YYYY-MM-DD'), 'daily', to_char(d, 'YYYY-MM-DD'),
       'ردم أثر رجعي', 'migration'
  FROM generate_series(
         (COALESCE((SELECT data->>'lastDailySent' FROM public.app_settings WHERE id='main'),
                   to_char(now(), 'YYYY-MM-DD'))::date - 60),
         COALESCE((SELECT data->>'lastDailySent' FROM public.app_settings WHERE id='main'),
                  to_char(now(), 'YYYY-MM-DD'))::date,
         '1 day'
       ) AS d
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════
-- استعلامات تحقّق
-- ════════════════════════════════════════════════════════════════════════

-- (أ) الجدول موجود؟ المتوقّع: صف واحد
SELECT table_name AS "الجدول" FROM information_schema.tables
 WHERE table_schema='public' AND table_name='report_log';

-- (ب) آخر التقارير المُرسَلة ومَن أرسلها — عمود «device» يكشف أي جهاز يرسل
SELECT id AS "التقرير", sent_at AS "وقت الإرسال",
       sent_by AS "المستخدم", device AS "الجهاز"
  FROM public.report_log
 ORDER BY sent_at DESC
 LIMIT 20;

-- (ج) كشف التكرار: يجب ألّا يُرجع أي صف إطلاقاً بعد هذه الهجرة.
--     (المفتاح الأساسي يمنعه بنيوياً — هذا فحص اطمئنان فقط.)
SELECT kind, day_key, count(*) AS "عدد الإرسالات"
  FROM public.report_log
 GROUP BY kind, day_key
HAVING count(*) > 1;
