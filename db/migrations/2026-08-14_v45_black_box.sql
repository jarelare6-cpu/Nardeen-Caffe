-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  v45 — الصندوق الأسود: سجل نشاط لا يُحذف + ساعة الخادم + فهارس    ║
-- ╚══════════════════════════════════════════════════════════════════╝
--
-- شغّل هذا الملف **مرة واحدة** في Supabase → SQL Editor.
-- آمن تماماً: قابل لإعادة التشغيل، لا يحذف بياناً، ولا يكسر التطبيق
-- الحالي إن لم يُشغَّل (كل ما يضيفه اختياري من ناحية الكود).
--
-- ما الذي يفعله بالضبط:
--  1) server_at  — ختم زمني من ساعة *الخادم* لا من ساعة الجهاز.
--  2) فهارس      — كي يبقى استعلام «إعادة تشغيل وردية» فورياً بعد سنة.
--  3) RLS        — إضافة وقراءة فقط. لا تعديل ولا حذف، لأي أحد.
--
-- ══════════════════════════════════════════════════════════════════════

-- ════════ 1) ساعة الخادم ════════
-- created_at يأتي من المتصفح (يمكن أن ينحرف أو يُغيَّر). server_at تضعه
-- القاعدة نفسها ولا يستطيع العميل تعيينه — فهو المرجع عند الترتيب.
ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS server_at timestamptz NOT NULL DEFAULT now();

-- الصفوف القديمة: نملأ server_at من created_at حتى لا تتكدّس كلها
-- على لحظة تشغيل الهجرة فيبدو تاريخك القديم وكأنه حدث اليوم.
UPDATE public.activity_log
   SET server_at = created_at
 WHERE server_at > created_at + interval '1 minute';

-- حارس: حتى لو أرسل عميلٌ قيمةً لـ server_at، القاعدة تتجاهلها.
CREATE OR REPLACE FUNCTION public.activity_log_stamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.server_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS activity_log_stamp_trg ON public.activity_log;
CREATE TRIGGER activity_log_stamp_trg
  BEFORE INSERT ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.activity_log_stamp();

-- ════════ 2) الفهارس ════════
-- «إعادة تشغيل وردية» تسأل: أعطني حركات هذا الفرع بين وقتين.
-- بلا فهرس مركّب تمسح القاعدة الجدول كله في كل فتح للشاشة.
CREATE INDEX IF NOT EXISTS activity_log_branch_server_idx
  ON public.activity_log (branch, server_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_server_at_idx
  ON public.activity_log (server_at DESC);

-- سجل حركات المخزون — كاشف الفاقد يستعلم بالصنف والسبب.
CREATE INDEX IF NOT EXISTS stock_movements_item_reason_idx
  ON public.stock_movements (item_id, reason, at DESC);

-- ════════ 3) السجل لا يُحذف ولا يُعدَّل ════════
-- السياسة القديمة كانت FOR ALL — أي أنها تسمح بـ UPDATE و DELETE أيضاً.
-- سجلٌ يمكن محوه ليس سجلاً. نستبدلها بسياستين ضيّقتين.
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_log_all    ON public.activity_log;
DROP POLICY IF EXISTS activity_log_read   ON public.activity_log;
DROP POLICY IF EXISTS activity_log_insert ON public.activity_log;

CREATE POLICY activity_log_read
  ON public.activity_log FOR SELECT USING (true);

CREATE POLICY activity_log_insert
  ON public.activity_log FOR INSERT WITH CHECK (true);

-- حزام أمان ثانٍ فوق RLS: سحب الصلاحية على مستوى الجدول نفسه.
REVOKE UPDATE, DELETE, TRUNCATE ON public.activity_log FROM anon, authenticated;
GRANT  SELECT, INSERT            ON public.activity_log TO   anon, authenticated;

-- ملاحظة: لك أنت (service_role / لوحة Supabase) تبقى الصلاحية كاملة،
-- فتستطيع التنظيف اليدوي عند الحاجة. المقصود منع المحو من التطبيق.

-- ════════ تحقّق بعد التنفيذ ════════
-- يجب أن يعود صفّان فقط: read (SELECT) و insert (INSERT)
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'activity_log';
--
-- يجب أن يعود فارغاً (لا صف بفارق كبير بين الساعتين):
--   SELECT id, created_at, server_at FROM public.activity_log
--    WHERE abs(extract(epoch FROM (server_at - created_at))) > 120
--    ORDER BY server_at DESC LIMIT 20;
