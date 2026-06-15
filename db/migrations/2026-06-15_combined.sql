-- ════════════════════════════════════════════════════════════════
-- Nardeen Caffe — هجرة موحّدة (v4.7.0 + v33)
-- نفّذها مرة واحدة في Supabase → SQL Editor. آمنة وقابلة لإعادة التنفيذ.
-- تجمع: دقّة المزامنة/التقارير + تقوية التزامن متعدّد الكاشير.
-- ════════════════════════════════════════════════════════════════

-- ─────────────── (1) دقّة المزامنة والتقارير (v4.7.0) ───────────────

-- إصلاح دقّة الخصم: كان NUMERIC(6,2) سقفه 9999.99، فأي خصم ≥ 10000 ل.س
-- كان يُفشل كتابة الطلب/الفاتورة بصمت ويُظهر "اختفاء/عودة" العنصر.
ALTER TABLE orders   ALTER COLUMN discount TYPE NUMERIC(12,2);
ALTER TABLE receipts ALTER COLUMN discount TYPE NUMERIC(12,2);

-- طابع زمني لحلّ تعارض المزامنة بين الأجهزة (الأحدث يفوز).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ربط المصروف بالوردية → تقرير إقفال دقيق مطابق لمبيعات/مصاريف اليوم.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS shift_id TEXT;

-- فهارس مساعدة (تُسرّع التقارير).
CREATE INDEX IF NOT EXISTS idx_orders_shift_id   ON orders(shift_id);
CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON orders(updated_at);
CREATE INDEX IF NOT EXISTS idx_expenses_shift_id ON expenses(shift_id);

-- ─────────────── (2) تقوية التزامن متعدّد الكاشير (v33) ───────────────
-- «أول إجراء نهائي يفوز»: متى أصبح الطلب (paid / debt / complimentary)
-- لا يُسمح بتحويله إلى حالة نهائية مختلفة من جهاز آخر متأخّر المزامنة،
-- فيتقارب الجميع على نفس النتيجة. يُسمح بالإلغاء (مرتجع) كاستثناء إداري.

CREATE OR REPLACE FUNCTION guard_terminal_order()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('paid','debt','complimentary')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status <> 'cancelled' THEN
    RETURN OLD;            -- الحالة النهائية محميّة — ارفض التحويل المتضارب
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_terminal ON orders;
CREATE TRIGGER trg_guard_terminal
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION guard_terminal_order();

-- ════════════════════════════════════════════════════════════════
-- انتهت الهجرة. بعد التنفيذ تصبح الحماية على مستوى الخادم فعّالة.
-- ════════════════════════════════════════════════════════════════
