-- ════════════════════════════════════════════════════════════════════════
-- Nardeen Caffe — هجرة v46 : سلامة الوردية واليوم المحاسبي
-- نفّذها مرة واحدة في Supabase ▸ SQL Editor. آمنة تماماً لإعادة التنفيذ.
-- تُنفَّذ بعد v41 / v42 / v43 (وإن لم تُنفَّذ فهي مستقلة عنها ولا تتعارض).
--
-- لماذا هذه الهجرة؟
--  الكود يكتب منذ إصدارات عدّة أعمدةً غير موجودة في جدول shifts:
--    shift_type · sec_expenses_total · closed_by_id · closed_by_name
--  ودالة upsertStrip في التطبيق تحذف أي عمود ناقص بصمت وتعيد المحاولة،
--  فتبدو الكتابة ناجحة بينما القيمة لم تصل القاعدة إطلاقاً.
--  الأثر المباشر: نوع الوردية (صباحية/مسائية/ليلية) لا يُحفَظ، فيعود من
--  السحابة فارغاً بعد أي تحديث صفحة — ومعه ينهار شرط إرسال الجرد اليومي
--  وتظهر كل الورديات في السجل بعلامة «—».
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══ ١) الأعمدة الناقصة في جدول الورديات ════════════════════════════════
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS shift_type         TEXT DEFAULT '';
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS sec_expenses_total NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS closed_by_id       TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS closed_by_name     TEXT DEFAULT '';

-- نقد سداد الديون الداخل للصندوق خلال الوردية.
-- كان يدخل معادلة «النقد المتوقع» عند الإقفال ولا يُحفَظ في أي عمود، فيستحيل
-- على أي تقرير لاحق إعادة إنتاج الرقم الذي رآه الكاشير على الشاشة.
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS debt_settled_cash  NUMERIC(12,2) DEFAULT 0;

-- اليوم المحاسبي الذي تنتمي إليه الوردية — يُحسَب مرة واحدة عند الإقفال
-- ويُخزَّن كنص 'YYYY-MM-DD'. سجلٌّ ثابت لا يُعاد اشتقاقه، فلا يتغيّر الجرد
-- التاريخي أبداً إذا تغيّرت قواعد الحساب مستقبلاً.
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS business_day       TEXT;

CREATE INDEX IF NOT EXISTS idx_shifts_business_day ON public.shifts(business_day);
CREATE INDEX IF NOT EXISTS idx_shifts_branch_status ON public.shifts(branch, status);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- ٢) ردم أثر رجعي: احسب business_day للورديات المُقفلة سابقاً
-- ────────────────────────────────────────────────────────────────────────
-- القاعدة المعتمدة (v46): الوردية تُنسب لليوم المحاسبي الذي **فُتحت** فيه،
-- لا الذي أُقفلت فيه. سبب التغيير: دورة العمل صباحية ← مسائية ← ليلية،
-- والليلية تُفتح ~19:00 غرينتش وتُقفل ~03:00 غرينتش من الغد. النسبة لوقت
-- الإقفال كانت ترمي ليلة الثلاثاء داخل جرد الأربعاء، فيصبح «اليوم» مكوّناً
-- من ليلةِ أمس + صباحِ اليوم + مساءِ اليوم — وهو ليس يوم عمل حقيقياً.
-- بالنسبة لوقت الفتح تجتمع الورديات الثلاث في اليوم نفسه كما هي في الواقع.
-- ════════════════════════════════════════════════════════════════════════
UPDATE public.shifts
   SET business_day = to_char(opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
 WHERE business_day IS NULL
   AND opened_at IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════
-- ٣) إصلاح مُشغِّل حماية الحالة النهائية
-- ────────────────────────────────────────────────────────────────────────
-- النسخة السابقة كانت ترفض أي انتقال من حالة نهائية عدا الإلغاء، ومن ضمنها
-- الانتقال المشروع  debt → paid  (سداد دين على الطلب نفسه، مستعمَل في شاشة
-- الطاولات). الرفض كان صامتاً: RETURN OLD يُبقي الصف كما هو دون خطأ، فيرى
-- الكاشير «مدفوع» على شاشته ويعود الطلب ديناً بعد أول مزامنة — فرق نقدي
-- حقيقي في جرد الصندوق.
--
-- القاعدة الجديدة: تُمنَع التحويلات المتضاربة فقط، ويُسمَح صراحةً بـ:
--   debt → paid            (سداد الدين)
--   أي حالة → cancelled     (مرتجع/إلغاء إداري)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.guard_terminal_order()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('paid','debt','complimentary')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status <> 'cancelled'
     AND NOT (OLD.status = 'debt' AND NEW.status = 'paid')
  THEN
    RETURN OLD;            -- تحويل متضارب من جهاز متأخّر المزامنة — يُرفَض
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_terminal ON public.orders;
CREATE TRIGGER trg_guard_terminal
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_terminal_order();

-- ════════════════════════════════════════════════════════════════════════
-- ٤) استعلامات تحقّق — شغّلها بعد الهجرة للتأكّد
-- ════════════════════════════════════════════════════════════════════════

-- (أ) هل اكتملت أعمدة shifts؟  المتوقّع: صفر صفوف.
WITH expected(col) AS (VALUES
  ('shift_type'),('sec_expenses_total'),('closed_by_id'),('closed_by_name'),
  ('debt_settled_cash'),('business_day'))
SELECT e.col AS "عمود ناقص في shifts"
  FROM expected e
  LEFT JOIN information_schema.columns c
    ON c.table_schema='public' AND c.table_name='shifts' AND c.column_name=e.col
 WHERE c.column_name IS NULL;

-- (ب) ورديات مفتوحة الآن (يجب ألا تتجاوز واحدة لكل فرع)
SELECT branch, count(*) AS "ورديات مفتوحة", min(opened_at) AS "أقدم فتح"
  FROM public.shifts WHERE status='open' GROUP BY branch;

-- (ج) ورديات متروكة مفتوحة أكثر من 16 ساعة — تحتاج إغلاقاً إدارياً
SELECT id, branch, shift_type, user_name, opened_at,
       round(EXTRACT(EPOCH FROM (now()-opened_at))/3600) AS "ساعات مفتوحة"
  FROM public.shifts
 WHERE status='open' AND opened_at < now() - interval '16 hours'
 ORDER BY opened_at;

-- (د) مطابقة الجرد اليومي لآخر 10 أيام:
--     مجموع الورديات مقابل عدد الورديات المتوقّع (3 يومياً للكافيه)
SELECT business_day AS "اليوم",
       count(*) AS "عدد الورديات",
       string_agg(COALESCE(NULLIF(shift_type,''),'؟'), ' + ' ORDER BY opened_at) AS "التسلسل",
       sum(total_sales)  AS "المبيعات",
       sum(cash_sales)   AS "النقدي",
       sum(tron_sales)   AS "الترون",
       sum(difference)   AS "فرق الصندوق"
  FROM public.shifts
 WHERE status='closed' AND business_day IS NOT NULL
 GROUP BY business_day
 ORDER BY business_day DESC
 LIMIT 10;
