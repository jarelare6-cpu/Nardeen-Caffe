-- ════════════════════════════════════════════════════════════════════════
-- Nardeen Caffe — هجرة v43  (نسخة مصحّحة — استبدل بها السابقة)
-- نفّذها مرة واحدة في Supabase ▸ SQL Editor. آمنة لإعادة التنفيذ.
-- تُنفَّذ بعد v41 و v42.
--
-- ما صُحّح عن النسخة الأولى:
--  • خطأ «each UNION query must have the same number of columns»:
--    orders_archive أُنشئ بـ LIKE orders قبل إضافة tron_shift_id، فصار
--    أقلّ أعمدة. الحل هنا مزدوج — مزامنة أعمدة الأرشيف + تسمية الأعمدة
--    صراحةً في الـ UNION بدل SELECT * (فلا يتكرّر العطل مع أي عمود مستقبلي).
--  • خطأ حسابي في cogs_total: كان يحتسب تكلفة الأصناف المُقدَّمة ضيافةً
--    كاملةً بدل استثنائها — عكس قاعدة orderCogs في التطبيق تماماً.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══ ٠) ضمان وجود جدول الأرشيف ومزامنة أعمدته مع orders ══════════════════
CREATE TABLE IF NOT EXISTS public.orders_archive (LIKE public.orders INCLUDING ALL);

-- الأعمدة التي أُضيفت لاحقاً وقد تنقص من الأرشيف
ALTER TABLE public.orders_archive ADD COLUMN IF NOT EXISTS tron_shift_id    TEXT;
ALTER TABLE public.orders_archive ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ;
ALTER TABLE public.orders_archive ADD COLUMN IF NOT EXISTS stock_deducted   BOOLEAN DEFAULT TRUE;
ALTER TABLE public.orders_archive ADD COLUMN IF NOT EXISTS shift_id         TEXT;
ALTER TABLE public.orders_archive ADD COLUMN IF NOT EXISTS preparing_at     TIMESTAMPTZ;
ALTER TABLE public.orders_archive ADD COLUMN IF NOT EXISTS ready_at         TIMESTAMPTZ;
ALTER TABLE public.orders_archive ADD COLUMN IF NOT EXISTS tron_amount      NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.orders_archive ADD COLUMN IF NOT EXISTS comp_amount      NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.orders_archive ADD COLUMN IF NOT EXISTS is_complimentary BOOLEAN DEFAULT FALSE;
ALTER TABLE public.orders_archive ADD COLUMN IF NOT EXISTS branch           TEXT DEFAULT 'main';

ALTER TABLE public.orders_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_archive_all ON public.orders_archive;
CREATE POLICY orders_archive_all ON public.orders_archive FOR ALL USING (true) WITH CHECK (true);

-- ══ ١) منع وردية مفتوحة مزدوجة على الفرع نفسه ═══════════════════════════
-- جهازان يفتحان وردية في اللحظة نفسها كان ينتج ورديتين مفتوحتين، فتتوزّع
-- الطلبات بينهما عشوائياً وينهار جرد الصندوق.
-- إن فشل السطر التالي فلديك ورديتان مفتوحتان على فرع واحد — استعمل استعلام
-- الكشف في نهاية الملف، أقفل إحداهما، ثم أعد التنفيذ.
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_branch
  ON public.shifts (branch)
  WHERE status = 'open';

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- ٢) تجميعات الخادم — نهاية البتر الصامت
-- الأعمدة مُسمّاة صراحةً: الـ UNION لا يتأثّر بأي عمود يُضاف لاحقاً.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sales_totals(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL,
  p_branch TEXT DEFAULT NULL
) RETURNS TABLE (
  orders_count   BIGINT,
  revenue        NUMERIC,
  cash_sales     NUMERIC,
  card_sales     NUMERIC,
  tron_total     NUMERIC,
  comp_total     NUMERIC,
  debt_total     NUMERIC,
  first_order_at TIMESTAMPTZ,
  last_order_at  TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH allo AS (
    SELECT status, payment_type, total, tron_amount, comp_amount,
           is_complimentary, paid_at, created_at, branch
      FROM public.orders
    UNION ALL
    SELECT status, payment_type, total, tron_amount, comp_amount,
           is_complimentary, paid_at, created_at, branch
      FROM public.orders_archive
  ), f AS (
    SELECT * FROM allo
    WHERE (p_from   IS NULL OR COALESCE(paid_at, created_at) >= p_from)
      AND (p_to     IS NULL OR COALESCE(paid_at, created_at) <  p_to)
      AND (p_branch IS NULL OR COALESCE(branch, 'main') = p_branch)
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'paid' AND NOT COALESCE(is_complimentary, false)),
    COALESCE(SUM(total)       FILTER (WHERE status = 'paid' AND NOT COALESCE(is_complimentary, false)), 0),
    COALESCE(SUM(total)       FILTER (WHERE status = 'paid' AND payment_type = 'cash' AND NOT COALESCE(is_complimentary, false)), 0),
    COALESCE(SUM(total)       FILTER (WHERE status = 'paid' AND payment_type = 'card' AND NOT COALESCE(is_complimentary, false)), 0),
    COALESCE(SUM(tron_amount) FILTER (WHERE status = 'paid'), 0),
    COALESCE(SUM(comp_amount), 0),
    COALESCE(SUM(total)       FILTER (WHERE status = 'debt'), 0),
    MIN(created_at),
    MAX(created_at)
  FROM f;
$$;

-- ── تكلفة البضاعة المباعة ───────────────────────────────────────────────
-- القاعدة (مطابِقة لـ orderCogs في التطبيق):
--   • سطر مُقدَّم ضيافةً بالكامل (complimentary = true) ⇒ تكلفته صفر.
--   • غير ذلك ⇒ تُحتسب (الكمية − الكمية المُقدَّمة ضيافةً) وبحدٍّ أدنى صفر.
-- النسخة الأولى كانت تعكس الشرط فتحتسب تكلفة الضيافة الكاملة بالخطأ.
CREATE OR REPLACE FUNCTION public.cogs_total(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH allo AS (
    SELECT status, items, paid_at, created_at FROM public.orders
    UNION ALL
    SELECT status, items, paid_at, created_at FROM public.orders_archive
  ), lines AS (
    SELECT
      (it->>'itemId') AS item_id,
      CASE
        WHEN COALESCE(it->>'complimentary', 'false') IN ('true', 't', '1') THEN 0
        ELSE GREATEST(
               0,
               COALESCE(NULLIF(it->>'qty', '')::numeric, 0)
             - COALESCE(NULLIF(it->>'compQty', '')::numeric, 0)
             )
      END AS billable_qty
    FROM allo o, LATERAL jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) AS it
    WHERE o.status = 'paid'
      AND (p_from IS NULL OR COALESCE(o.paid_at, o.created_at) >= p_from)
      AND (p_to   IS NULL OR COALESCE(o.paid_at, o.created_at) <  p_to)
  )
  SELECT COALESCE(SUM(l.billable_qty * COALESCE(m.cost, 0)), 0)
  FROM lines l
  JOIN public.menu_items m ON m.id = l.item_id;
$$;

CREATE OR REPLACE FUNCTION public.expenses_totals(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (primary_total NUMERIC, secondary_total NUMERIC, cnt BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE NOT COALESCE(is_secondary,false) AND NOT COALESCE(is_complimentary,false)), 0),
    COALESCE(SUM(amount) FILTER (WHERE COALESCE(is_secondary,false)), 0),
    COUNT(*)
  FROM public.expenses
  WHERE (p_from IS NULL OR date >= p_from) AND (p_to IS NULL OR date < p_to);
$$;

-- أداء الموظفين — من الورديات المُقفلة (سجل كامل لا يُبتر)
CREATE OR REPLACE FUNCTION public.staff_performance(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  user_name      TEXT,
  shifts_count   BIGINT,
  orders_count   BIGINT,
  total_sales    NUMERIC,
  cash_sales     NUMERIC,
  tron_sales     NUMERIC,
  comp_total     NUMERIC,
  debt_total     NUMERIC,
  expenses_total NUMERIC,
  variance_sum   NUMERIC,
  variance_abs   NUMERIC,
  worst_variance NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(s.user_name, 'غير محدد'),
    COUNT(*),
    COALESCE(SUM(s.orders_count), 0)::BIGINT,
    COALESCE(SUM(s.total_sales), 0),
    COALESCE(SUM(s.cash_sales), 0),
    COALESCE(SUM(s.tron_sales), 0),
    COALESCE(SUM(s.comp_total), 0),
    COALESCE(SUM(s.debt_total), 0),
    COALESCE(SUM(s.expenses_total), 0),
    COALESCE(SUM(s.difference), 0),
    COALESCE(SUM(ABS(s.difference)), 0),
    COALESCE(MIN(s.difference), 0)
  FROM public.shifts s
  WHERE s.status = 'closed'
    AND (p_from IS NULL OR s.closed_at >= p_from)
    AND (p_to   IS NULL OR s.closed_at <  p_to)
  GROUP BY COALESCE(s.user_name, 'غير محدد')
  ORDER BY 4 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.sales_totals(TIMESTAMPTZ,TIMESTAMPTZ,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cogs_total(TIMESTAMPTZ,TIMESTAMPTZ)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expenses_totals(TIMESTAMPTZ,TIMESTAMPTZ)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_performance(TIMESTAMPTZ,TIMESTAMPTZ) TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- ٣) خصم/إرجاع مخزون الطلب — ذرّي ومُسجَّل ومُحصَّن ضد التكرار
-- كان البيع يخصم بكتابة قيمة مطلقة من المتصفح وخارج سجل الحركات.
-- الآن: خصم نسبي داخل القاعدة + حركة لكل صنف، ومعرّف الحركة مشتقّ من
-- (المفتاح + الصنف + السبب) فإعادة الإرسال لا تخصم مرتين.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.adjust_stock_bulk(
  p_items     JSONB,
  p_sign      INT     DEFAULT -1,
  p_reason    TEXT    DEFAULT 'sale',
  p_order_id  TEXT    DEFAULT NULL,
  p_order_num TEXT    DEFAULT '',
  p_user_id   TEXT    DEFAULT NULL,
  p_user_name TEXT    DEFAULT '',
  p_user_role TEXT    DEFAULT '',
  p_shift_id  TEXT    DEFAULT NULL,
  p_branch    TEXT    DEFAULT 'main',
  p_key       TEXT    DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        RECORD;
  v_after  NUMERIC;
  v_name   TEXT;
  v_mid    TEXT;
  v_key    TEXT := COALESCE(p_key, p_order_id, 'k_' || replace(gen_random_uuid()::text, '-', ''));
  v_n      INT := 0;
BEGIN
  FOR r IN
    SELECT (it->>'itemId') AS item_id,
           COALESCE(NULLIF(it->>'qty', '')::numeric, 0) AS qty
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it
  LOOP
    CONTINUE WHEN r.item_id IS NULL OR r.qty <= 0;

    v_mid := 'mv_' || v_key || '_' || r.item_id || '_' || p_reason;
    CONTINUE WHEN EXISTS (SELECT 1 FROM stock_movements WHERE id = v_mid);

    UPDATE menu_items
       SET stock      = GREATEST(0, COALESCE(stock, 0) + (p_sign * r.qty)),
           total_sold = GREATEST(0, COALESCE(total_sold, 0) - (p_sign * r.qty))
     WHERE id = r.item_id
       AND COALESCE(track_stock, true) = true
     RETURNING stock, name INTO v_after, v_name;

    CONTINUE WHEN NOT FOUND;

    INSERT INTO stock_movements (id, kind, item_id, item_name, delta, qty_after, reason,
                                 order_id, order_num, user_id, user_name, user_role,
                                 shift_id, branch)
    VALUES (v_mid, 'menu', r.item_id, v_name, p_sign * r.qty, v_after, p_reason,
            p_order_id, p_order_num, p_user_id, p_user_name, p_user_role,
            p_shift_id, p_branch);

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_stock_bulk(JSONB,INT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
  TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- تحقّق بعد التنفيذ
-- ════════════════════════════════════════════════════════════════════════
-- ورديات مفتوحة مزدوجة (يجب أن يعود فارغاً):
--   SELECT branch, COUNT(*) FROM public.shifts WHERE status='open'
--    GROUP BY branch HAVING COUNT(*) > 1;
--
--   SELECT * FROM public.sales_totals();     -- كل الوقت فعلاً (يشمل الأرشيف)
--   SELECT public.cogs_total();
--   SELECT * FROM public.expenses_totals();
--   SELECT * FROM public.staff_performance();
