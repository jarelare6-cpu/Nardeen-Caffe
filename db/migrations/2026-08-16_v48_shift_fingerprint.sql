-- ════════════════════════════════════════════════════════════════════════
-- Nardeen Caffe — هجرة v48 : بصمة الوردية
-- نفّذها مرة واحدة في Supabase ▸ SQL Editor. آمنة لإعادة التنفيذ.
-- تُنفَّذ بعد v46 و v47.2.
--
-- ما تضيفه:
--   عمود fingerprint (JSONB) على جدول shifts — يحمل بصمة تشفيرية تُحسَب
--   لحظة الإقفال على محتوى الوردية (الطلبات · الصندوق · المصاريف · المخزون).
--   في أي وقت لاحق يُعاد الحساب ويُقارَن، فيُكشَف أي تعديل جرى بعد الإقفال
--   ويُحدَّد أي جزء منه تغيّر بالضبط.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS fingerprint JSONB;

-- فهرس على البصمة الكلية — يُسرّع البحث عن وردية ببصمتها
CREATE INDEX IF NOT EXISTS idx_shifts_fingerprint
  ON public.shifts ((fingerprint->>'all'));

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- تحقّق
-- ════════════════════════════════════════════════════════════════════════

-- (أ) العمود موجود؟ المتوقّع: صف واحد
SELECT column_name AS "العمود", data_type AS "النوع"
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='shifts' AND column_name='fingerprint';

-- (ب) الورديات المبصومة مقابل غير المبصومة
--     الورديات المُقفلة قبل v48 ستظهر «بلا بصمة» — طبيعي ولا يُصلَح
--     بأثر رجعي (بصمة تُحسب اليوم على بيانات قد تكون تغيّرت لا تُثبت شيئاً).
SELECT
  count(*) FILTER (WHERE fingerprint IS NOT NULL) AS "مبصومة",
  count(*) FILTER (WHERE fingerprint IS NULL AND status='closed') AS "مقفلة بلا بصمة"
  FROM public.shifts;

-- (ج) تحقّق من وجود جدول قفل التقارير (هجرة v47.2) — إن رجع صفر صفوف
--     فالهجرة لم تُنفَّذ، ويجب تنفيذها قبل الاعتماد على منع تكرار التقارير.
SELECT table_name AS "جدول قفل التقارير موجود"
  FROM information_schema.tables
 WHERE table_schema='public' AND table_name='report_log';
