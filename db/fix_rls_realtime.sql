-- ══════════════════════════════════════════════════════════════════════════
--  إصلاح المشكلة 1: طلب الزبون لا يصل لقاعدة البيانات
--
--  السبب: RLS مفعّل لكن سياسة السماح غير مطبّقة فعلياً، فيُرفض كل إدراج.
--  هذا الملف يفرض إعادة إنشاء السياسات المسموحة + تفعيل Realtime (idempotent).
--  شغّله مرة واحدة في:  Supabase ▸ SQL Editor ▸ Run.
-- ══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','menu_items','orders','tables','debts','expenses',
    'cash_log','receipts','comp_log','customers','shifts','loyalty_log',
    'app_settings','perm_overrides'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    -- احذف السياسة القديمة (قد تكون ناقصة/معطوبة) ثم أعد إنشاءها مسموحة بالكامل
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (true) WITH CHECK (true);',
      t || '_all', t
    );
    -- تأكّد من وجود الجدول في منشور Realtime
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I;', t);
    END IF;
  END LOOP;
END $$;

-- تحقّق بعد التشغيل: يجب أن يرجع صفّاً لكل جدول
SELECT tablename, policyname, cmd FROM pg_policies WHERE policyname LIKE '%_all' ORDER BY tablename;
