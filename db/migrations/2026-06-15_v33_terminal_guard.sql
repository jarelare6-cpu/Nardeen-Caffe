-- ════════════════════════════════════════════════════════════════
-- Nardeen Caffe — هجرة v33 (تقوية التزامن متعدّد الكاشير) — اختيارية لكن مُوصى بها
-- نفّذها مرة واحدة في Supabase → SQL Editor. آمنة لإعادة التنفيذ.
--
-- الغرض: «أول إجراء نهائي يفوز» على مستوى الخادم. متى أصبح الطلب
-- (paid / debt / complimentary) لا يُسمح بتحويله إلى حالة نهائية مختلفة
-- من جهاز آخر متأخّر المزامنة — فيتقارب الجميع على نفس النتيجة ولا يتضارب
-- (دفع مقابل دين مقابل ضيافة). يُسمح بالإلغاء (مرتجع) كاستثناء إداري.
--
-- ملاحظة: إصلاحات العميل (معرّفات نقد/فاتورة حتمية + حُرّاس الإغلاق +
-- اعتماد الحالة النهائية من الخادم) تمنع ازدواج المال وتضمن التقارب وحدها؛
-- هذا الـTrigger طبقة دفاع إضافية للسباقات اللحظية على نفس الطلب.
-- ════════════════════════════════════════════════════════════════

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
