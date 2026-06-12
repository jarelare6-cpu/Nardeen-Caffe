-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  Nardeen Caffe — المخطط الكامل الموحّد (schema_full)  v23        ║
-- ║  ملف واحد شامل لكل قاعدة البيانات — idempotent                   ║
-- ║  آمن للتشغيل على قاعدة موجودة (لا يحذف بيانات) أو قاعدة جديدة     ║
-- ║  يحل محل: nardeen_v8_full + 023 + heartbeat + fix_rls_realtime   ║
-- ║            + activity_log + pay_order (كلها مدمجة هنا)            ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ════════ 1) الجداول الأساسية + ترقيات الأعمدة ════════
-- 1) الجداول الأساسية  (CREATE … IF NOT EXISTS)
-- ══════════════════════════════════════════════════════════════════════════

-- ── المستخدمون / الموظفون ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT PRIMARY KEY,
  username    TEXT UNIQUE,
  password    TEXT,                       -- يُخزَّن مشفّراً SHA-256 تلقائياً
  role        TEXT DEFAULT 'worker',      -- admin | cashier | worker | bar | hookah | customer
  name        TEXT DEFAULT '',
  email       TEXT DEFAULT '',
  active      BOOLEAN DEFAULT TRUE,
  shift       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── المنيو ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id            TEXT PRIMARY KEY,
  name          TEXT DEFAULT '',
  name_en       TEXT DEFAULT '',
  price         NUMERIC(12,2) DEFAULT 0,
  category      TEXT DEFAULT 'hot_drinks', -- hot_drinks | cold_drinks | food | hookah
  stock         INTEGER DEFAULT 0,
  min_stock     INTEGER DEFAULT 5,
  total_sold    INTEGER DEFAULT 0,
  emoji         TEXT DEFAULT '',
  active        BOOLEAN DEFAULT TRUE,
  outdoor_price NUMERIC(12,2),
  image_url     TEXT DEFAULT '',           -- ★ v8: صورة الصنف (اختياري)
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── الطلبات ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT PRIMARY KEY,
  order_num          TEXT DEFAULT '',
  customer_name      TEXT DEFAULT 'زبون',
  customer_id        TEXT,
  table_num          TEXT DEFAULT '',
  items              JSONB DEFAULT '[]',
  total              NUMERIC(12,2) DEFAULT 0,
  discount           NUMERIC(6,2)  DEFAULT 0,
  status             TEXT DEFAULT 'pending', -- pending|preparing|ready|paid|cancelled|debt|complimentary
  payment_type       TEXT DEFAULT 'cash',    -- cash|card|tron|debt
  payment_status     TEXT DEFAULT 'pending',
  partial_paid       NUMERIC(12,2) DEFAULT 0,
  notes              TEXT DEFAULT '',
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  paid_at            TIMESTAMPTZ,
  paid_by            TEXT,
  paid_by_name       TEXT DEFAULT '',
  is_debt_settlement BOOLEAN DEFAULT FALSE,
  original_total     NUMERIC(12,2),
  comp_amount        NUMERIC(12,2) DEFAULT 0,
  is_complimentary   BOOLEAN DEFAULT FALSE,
  worker_name        TEXT DEFAULT '',
  tron_amount        NUMERIC(12,2) DEFAULT 0,
  branch             TEXT DEFAULT 'main',    -- main | outdoor
  shift_id           TEXT,
  preparing_at       TIMESTAMPTZ,
  ready_at           TIMESTAMPTZ
);

-- ── الطاولات ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tables (
  id         TEXT PRIMARY KEY,
  number     INTEGER DEFAULT 0,
  num        TEXT DEFAULT '',
  label      TEXT DEFAULT '',
  seats      INTEGER DEFAULT 4,
  status     TEXT DEFAULT 'free',  -- free | occupied
  note       TEXT DEFAULT '',
  order_id   TEXT,
  opened_at  TIMESTAMPTZ,
  branch     TEXT DEFAULT 'main'
);

-- ── الديون ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS debts (
  id            TEXT PRIMARY KEY,
  customer_name TEXT DEFAULT '',
  amount        NUMERIC(12,2) DEFAULT 0,
  remaining     NUMERIC(12,2) DEFAULT 0,
  settled       BOOLEAN DEFAULT FALSE,
  settled_at    TIMESTAMPTZ,
  date          TIMESTAMPTZ DEFAULT NOW(),
  notes         TEXT DEFAULT '',
  created_by    TEXT DEFAULT '',
  order_id      TEXT,
  order_num     TEXT DEFAULT '',
  branch        TEXT DEFAULT 'main'
);

-- ── المصاريف ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id               TEXT PRIMARY KEY,
  label            TEXT DEFAULT '',
  description      TEXT DEFAULT '',
  amount           NUMERIC(12,2) DEFAULT 0,
  category         TEXT DEFAULT 'other',
  date             TIMESTAMPTZ DEFAULT NOW(),
  by               TEXT DEFAULT '',
  created_by       TEXT DEFAULT '',
  notes            TEXT DEFAULT '',
  is_secondary     BOOLEAN DEFAULT FALSE,
  order_id         TEXT,
  order_num        TEXT DEFAULT '',
  is_complimentary BOOLEAN DEFAULT FALSE
);

-- ── سجل النقد ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_log (
  id        TEXT PRIMARY KEY,
  order_id  TEXT,
  order_num TEXT DEFAULT '',
  amount    NUMERIC(12,2) DEFAULT 0,
  at        TIMESTAMPTZ DEFAULT NOW(),
  by        TEXT DEFAULT '',
  type      TEXT DEFAULT 'sale',
  branch    TEXT DEFAULT 'main',
  shift_id  TEXT
);

-- ── الفواتير ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receipts (
  id            TEXT PRIMARY KEY,
  order_id      TEXT,
  order_num     TEXT DEFAULT '',
  customer_name TEXT DEFAULT '',
  table_num     TEXT DEFAULT '',
  items         JSONB DEFAULT '[]',
  total         NUMERIC(12,2) DEFAULT 0,
  discount      NUMERIC(6,2)  DEFAULT 0,
  payment_type  TEXT DEFAULT 'cash',
  notes         TEXT DEFAULT '',
  created_by    TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  cafe_name     TEXT DEFAULT 'ناردين كافيه',
  tron_amount   NUMERIC(12,2) DEFAULT 0,
  branch        TEXT DEFAULT 'main'
);

-- ── سجل الضيافة ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comp_log (
  id            TEXT PRIMARY KEY,
  order_id      TEXT,
  order_num     TEXT DEFAULT '',
  customer_name TEXT DEFAULT '',
  table_num     TEXT DEFAULT '',
  items         JSONB DEFAULT '[]',
  amount        NUMERIC(12,2) DEFAULT 0,
  reason        TEXT DEFAULT '',
  created_by    TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  branch        TEXT DEFAULT 'main'
);

-- ── الزبائن (مع الولاء) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id               TEXT PRIMARY KEY,
  name             TEXT DEFAULT '',
  phone            TEXT DEFAULT '',
  email            TEXT DEFAULT '',
  visits           INTEGER DEFAULT 0,
  total_orders     INTEGER DEFAULT 0,
  total_spent      NUMERIC(12,2) DEFAULT 0,
  notes            TEXT DEFAULT '',
  loyalty_points   NUMERIC(12,2) DEFAULT 0,
  loyalty_redeemed NUMERIC(12,2) DEFAULT 0,
  tier             TEXT DEFAULT 'bronze',  -- bronze|silver|gold|vip
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  last_visit       TIMESTAMPTZ,
  orders           JSONB DEFAULT '[]'
);

-- ── الورديات (تقفيل الوردية) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shifts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  user_name       TEXT DEFAULT '',
  branch          TEXT DEFAULT 'main',     -- main | outdoor
  opened_at       TIMESTAMPTZ DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  opening_cash    NUMERIC(12,2) DEFAULT 0,
  expected_cash   NUMERIC(12,2) DEFAULT 0,
  counted_cash    NUMERIC(12,2) DEFAULT 0,
  difference      NUMERIC(12,2) DEFAULT 0,
  total_sales     NUMERIC(12,2) DEFAULT 0,
  cash_sales      NUMERIC(12,2) DEFAULT 0,
  card_sales      NUMERIC(12,2) DEFAULT 0,
  tron_sales      NUMERIC(12,2) DEFAULT 0,
  debt_total      NUMERIC(12,2) DEFAULT 0,
  comp_total      NUMERIC(12,2) DEFAULT 0,
  orders_count    INTEGER DEFAULT 0,
  expenses_total  NUMERIC(12,2) DEFAULT 0,
  status          TEXT DEFAULT 'open',     -- open | closed
  notes           TEXT DEFAULT '',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── سجل حركات الولاء ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty_log (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT,
  customer_name TEXT DEFAULT '',
  type          TEXT DEFAULT 'earn',  -- earn | redeem
  points        NUMERIC(12,2) DEFAULT 0,
  order_id      TEXT,
  order_num     TEXT DEFAULT '',
  note          TEXT DEFAULT '',
  created_by    TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── إعدادات التطبيق + تجاوزات الصلاحيات ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  id         TEXT PRIMARY KEY DEFAULT 'main',
  data       JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS perm_overrides (
  id         TEXT PRIMARY KEY DEFAULT 'main',
  data       JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════
-- 2) ترقية القواعد القديمة  (ALTER … ADD COLUMN IF NOT EXISTS)
--     لا يؤثّر على قاعدة جديدة — لضمان توافق أي قاعدة سابقة.
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url        TEXT DEFAULT '';
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS outdoor_price    NUMERIC(12,2);

ALTER TABLE orders     ADD COLUMN IF NOT EXISTS branch           TEXT DEFAULT 'main';
ALTER TABLE orders     ADD COLUMN IF NOT EXISTS partial_paid     NUMERIC(12,2) DEFAULT 0;
ALTER TABLE orders     ADD COLUMN IF NOT EXISTS payment_status   TEXT DEFAULT 'pending';
ALTER TABLE orders     ADD COLUMN IF NOT EXISTS comp_amount      NUMERIC(12,2) DEFAULT 0;
ALTER TABLE orders     ADD COLUMN IF NOT EXISTS original_total   NUMERIC(12,2);
ALTER TABLE orders     ADD COLUMN IF NOT EXISTS is_complimentary BOOLEAN DEFAULT FALSE;
ALTER TABLE orders     ADD COLUMN IF NOT EXISTS tron_amount      NUMERIC(12,2) DEFAULT 0;
ALTER TABLE orders     ADD COLUMN IF NOT EXISTS shift_id         TEXT;
ALTER TABLE orders     ADD COLUMN IF NOT EXISTS preparing_at     TIMESTAMPTZ;
ALTER TABLE orders     ADD COLUMN IF NOT EXISTS ready_at         TIMESTAMPTZ;

ALTER TABLE customers  ADD COLUMN IF NOT EXISTS loyalty_points   NUMERIC(12,2) DEFAULT 0;
ALTER TABLE customers  ADD COLUMN IF NOT EXISTS loyalty_redeemed NUMERIC(12,2) DEFAULT 0;
ALTER TABLE customers  ADD COLUMN IF NOT EXISTS tier             TEXT DEFAULT 'bronze';
ALTER TABLE customers  ADD COLUMN IF NOT EXISTS phone            TEXT DEFAULT '';
ALTER TABLE customers  ADD COLUMN IF NOT EXISTS total_orders     INTEGER DEFAULT 0;
ALTER TABLE customers  ADD COLUMN IF NOT EXISTS total_spent      NUMERIC(12,2) DEFAULT 0;

ALTER TABLE debts      ADD COLUMN IF NOT EXISTS branch           TEXT DEFAULT 'main';
ALTER TABLE comp_log   ADD COLUMN IF NOT EXISTS branch           TEXT DEFAULT 'main';
ALTER TABLE cash_log   ADD COLUMN IF NOT EXISTS branch           TEXT DEFAULT 'main';
ALTER TABLE cash_log   ADD COLUMN IF NOT EXISTS shift_id         TEXT;
ALTER TABLE receipts   ADD COLUMN IF NOT EXISTS branch           TEXT DEFAULT 'main';
ALTER TABLE receipts   ADD COLUMN IF NOT EXISTS tron_amount      NUMERIC(12,2) DEFAULT 0;


-- ════════ 2) أعمدة 023: أيقونة وتكلفة الأصناف ════════
-- 023: حفظ صورة الأيقونة وسعر التكلفة سحابيًا للأصناف
-- آمن للتشغيل أكثر من مرة (IF NOT EXISTS)
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_icon text DEFAULT '';
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS cost numeric DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS track_stock boolean DEFAULT true; -- v28: مخزون مرن


-- ════════ 3) v23: خصم المخزون عند الدفع ════════
-- ══════════════════════════════════════════════════════════════
-- v23: خصم المخزون عند الدفع — عمود تتبع على الطلبات
-- الطلبات القديمة default TRUE (خُصمت عند الإنشاء بالنظام السابق)
-- ══════════════════════════════════════════════════════════════
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_deducted BOOLEAN DEFAULT TRUE;


-- ════════ 4) RLS + Realtime لكل الجداول ════════
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


-- ════════ 5) الفهارس ════════
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_branch      ON orders(branch);
CREATE INDEX IF NOT EXISTS idx_orders_shift       ON orders(shift_id);
CREATE INDEX IF NOT EXISTS idx_orders_created      ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_category       ON menu_items(category);
CREATE INDEX IF NOT EXISTS idx_cash_log_at         ON cash_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_log_branch     ON cash_log(branch);
CREATE INDEX IF NOT EXISTS idx_cash_shift          ON cash_log(shift_id);
CREATE INDEX IF NOT EXISTS idx_receipts_created    ON receipts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_branch     ON receipts(branch);
CREATE INDEX IF NOT EXISTS idx_customers_loyalty   ON customers(loyalty_points DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_user         ON shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status       ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_shifts_opened       ON shifts(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_customer    ON loyalty_log(customer_id);
CREATE INDEX IF NOT EXISTS idx_debts_settled       ON debts(settled);
CREATE INDEX IF NOT EXISTS idx_comp_created        ON comp_log(created_at DESC);



-- ════════ 6) نبض الأجهزة ════════
-- ════════════════════════════════════════════════════════════
-- جدول نبض الأجهزة (heartbeat) للمراقبة عن بُعد
-- شغّل هذا مرة واحدة في Supabase ← SQL Editor
-- ════════════════════════════════════════════════════════════

create table if not exists device_status (
  id        text primary key,
  label     text,
  role      text,
  last_seen timestamptz default now(),
  online    boolean default true
);

alter table device_status enable row level security;

drop policy if exists device_status_open on device_status;
create policy device_status_open on device_status
  for all using (true) with check (true);

-- اختياري: تفعيل التحديث اللحظي (التطبيق يحدّث كل 30 ثانية بدونه أيضًا)
-- alter publication supabase_realtime add table device_status;


-- ════════ 7) سجل النشاط ════════
-- ══════════════════════════════════════════════════════════════
-- v22: activity_log — سجل النشاط (من فعل ماذا ومتى)
-- شغّل هذا الملف مرة واحدة في Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.activity_log (
  id         text PRIMARY KEY,
  action     text NOT NULL DEFAULT '',
  details    text NOT NULL DEFAULT '',
  user_name  text NOT NULL DEFAULT '',
  user_role  text NOT NULL DEFAULT '',
  order_num  text NOT NULL DEFAULT '',
  amount     numeric,
  branch     text NOT NULL DEFAULT 'main',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_created_at_idx
  ON public.activity_log (created_at DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'activity_log' AND policyname = 'activity_log_all'
  ) THEN
    CREATE POLICY activity_log_all ON public.activity_log
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- تفعيل التحديث الفوري (Realtime) للجدول
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ════════ 8) الدفع الذرّي ════════
-- ══════════════════════════════════════════════════════════════
-- v22: pay_order — دفع ذرّي بمعاملة واحدة
-- شغّل هذا الملف مرة واحدة في Supabase → SQL Editor
-- يُحدّث الطلب + يسجّل النقد + يحرّر الطاولة دفعة واحدة (كل شيء أو لا شيء)
-- ملاحظة: التطبيق يعمل بدون هذه الدالة (fallback تسلسلي) لكنها تضمن الذرّية.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pay_order(
  p_order      jsonb,
  p_cash       jsonb,
  p_free_table boolean DEFAULT false,
  p_table_num  text    DEFAULT '',
  p_branch     text    DEFAULT 'main'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1) تحديث/إدراج الطلب المدفوع
  INSERT INTO orders (
    id, order_num, customer_name, customer_id, table_num, items,
    total, discount, status, payment_type, payment_status, partial_paid,
    notes, created_at, paid_at, paid_by, paid_by_name,
    is_debt_settlement, original_total, comp_amount, is_complimentary,
    worker_name, tron_amount, branch, shift_id, preparing_at, ready_at, stock_deducted
  )
  SELECT
    x.id, x.order_num, x.customer_name, x.customer_id, x.table_num, x.items,
    x.total, x.discount, x.status, x.payment_type, x.payment_status, x.partial_paid,
    x.notes, x.created_at, x.paid_at, x.paid_by, x.paid_by_name,
    x.is_debt_settlement, x.original_total, x.comp_amount, x.is_complimentary,
    x.worker_name, x.tron_amount, x.branch, x.shift_id, x.preparing_at, x.ready_at, COALESCE(x.stock_deducted, true)
  FROM jsonb_to_record(p_order) AS x(
    id text, order_num text, customer_name text, customer_id text, table_num text, items jsonb,
    total numeric, discount numeric, status text, payment_type text, payment_status text, partial_paid numeric,
    notes text, created_at timestamptz, paid_at timestamptz, paid_by text, paid_by_name text,
    is_debt_settlement boolean, original_total numeric, comp_amount numeric, is_complimentary boolean,
    worker_name text, tron_amount numeric, branch text, shift_id text, preparing_at timestamptz, ready_at timestamptz, stock_deducted boolean
  )
  ON CONFLICT (id) DO UPDATE SET
    status         = EXCLUDED.status,
    payment_type   = EXCLUDED.payment_type,
    payment_status = EXCLUDED.payment_status,
    partial_paid   = EXCLUDED.partial_paid,
    total          = EXCLUDED.total,
    discount       = EXCLUDED.discount,
    original_total = EXCLUDED.original_total,
    paid_at        = EXCLUDED.paid_at,
    paid_by        = EXCLUDED.paid_by,
    paid_by_name   = EXCLUDED.paid_by_name,
    tron_amount    = EXCLUDED.tron_amount,
    shift_id       = EXCLUDED.shift_id,
    stock_deducted = EXCLUDED.stock_deducted;

  -- 2) سجل النقد
  INSERT INTO cash_log (id, order_id, order_num, amount, at, by, type, branch)
  SELECT y.id, y.order_id, y.order_num, y.amount, y.at, y.by, y.type, y.branch
  FROM jsonb_to_record(p_cash) AS y(
    id text, order_id text, order_num text, amount numeric,
    at timestamptz, "by" text, type text, branch text
  )
  ON CONFLICT (id) DO NOTHING;

  -- 3) تحرير الطاولة (اختياري)
  IF p_free_table AND COALESCE(p_table_num, '') <> '' THEN
    UPDATE tables
       SET status = 'free', order_id = NULL, opened_at = NULL
     WHERE num = p_table_num
       AND branch = COALESCE(NULLIF(p_branch, ''), 'main');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_order(jsonb, jsonb, boolean, text, text) TO anon, authenticated;


-- ════════ 9) الأرشفة التلقائية ════════
-- ══════════════════════════════════════════════════════════════
-- v23: الأرشفة التلقائية — نقل الطلبات المنتهية الأقدم من 90 يوماً
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.orders_archive (LIKE public.orders INCLUDING ALL);

ALTER TABLE public.orders_archive ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='orders_archive' AND policyname='orders_archive_all') THEN
    CREATE POLICY orders_archive_all ON public.orders_archive FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.archive_old_orders(p_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE moved integer;
BEGIN
  WITH old_rows AS (
    DELETE FROM orders
     WHERE created_at < now() - make_interval(days => p_days)
       AND status IN ('paid','cancelled','debt','complimentary')
    RETURNING *
  )
  INSERT INTO orders_archive SELECT * FROM old_rows
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS moved = ROW_COUNT;
  RETURN moved;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_old_orders(integer) TO anon, authenticated;

-- جدولة يومية عبر pg_cron إن كانت متاحة (وإلا يستدعيها التطبيق يومياً من جهاز الأدمن)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nardeen_archive_daily') THEN
    PERFORM cron.schedule('nardeen_archive_daily', '0 4 * * *', $job$SELECT public.archive_old_orders(90);$job$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron غير متاح — سيُشغّل التطبيق الأرشفة يومياً من جهاز الأدمن';
END $$;
