-- ════════════════════════════════════════════════════════════════
-- Nardeen Caffe — هجرة v4.7.0 (دقّة المزامنة والتقارير)
-- نفّذها مرة واحدة في Supabase → SQL Editor. آمنة لإعادة التنفيذ.
-- ════════════════════════════════════════════════════════════════

-- (3) إصلاح دقّة الخصم: كان NUMERIC(6,2) سقفه 9999.99، فأي خصم ≥ 10000 ل.س
--     كان يُفشل كتابة الطلب/الفاتورة بصمت ويُظهر "اختفاء/عودة" العنصر.
ALTER TABLE orders   ALTER COLUMN discount TYPE NUMERIC(12,2);
ALTER TABLE receipts ALTER COLUMN discount TYPE NUMERIC(12,2);

-- (1،7) طابع زمني لحلّ تعارض المزامنة بين الأجهزة (الأحدث يفوز).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- (2) ربط المصروف بالوردية → تقرير إقفال دقيق مطابق لمبيعات/مصاريف اليوم.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS shift_id TEXT;

-- فهارس مساعدة (اختيارية لكنها تُسرّع التقارير)
CREATE INDEX IF NOT EXISTS idx_orders_shift_id   ON orders(shift_id);
CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON orders(updated_at);
CREATE INDEX IF NOT EXISTS idx_expenses_shift_id ON expenses(shift_id);
