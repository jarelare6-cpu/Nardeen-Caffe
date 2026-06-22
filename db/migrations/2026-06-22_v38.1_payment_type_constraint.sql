-- ════════════════════════════════════════════════════════════════
-- Nardeen Caffe — هجرة v38.1: إزالة قيد payment_type المقيِّد
-- نفّذها مرة واحدة في Supabase → SQL Editor. آمنة لإعادة التنفيذ.
--
-- السبب: قيد orders_payment_type_check كان يرفض القيمة 'worker' (مشروب العامل)
-- فيفشل حفظ حالة الطلب ويعود للظهور في الكاشير بعد التحديث.
--
-- ملاحظة: إصلاح التطبيق (v38.1) يعمل دون هذه الهجرة (يرسل قيمة آمنة)،
-- لكن تنفيذها يسمح بإبقاء الدلالة الأصلية ويمنع أي رفض مستقبلي.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_type_check;

-- (اختياري) قيد متساهل يقبل كل القيم المستخدمة فعليًا:
-- ALTER TABLE orders ADD CONSTRAINT orders_payment_type_check
--   CHECK (payment_type IN ('cash','card','tron','debt','debt_settled','debt_payment','worker','complimentary'));
