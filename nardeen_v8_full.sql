-- ══════════════════════════════════════════════════════════════════════════
--  Nardeen Caffe — قاعدة البيانات الكاملة (v8)
--  ملف واحد موحّد يُغني عن كل ملفات الـ SQL السابقة (v1 … v7).
--
--  ▸ آمن للتشغيل على قاعدة جديدة (ينشئ كل شيء من الصفر).
--  ▸ آمن للتشغيل على قاعدة قائمة (idempotent — لا يحذف أي بيانات،
--    يضيف فقط الناقص عبر IF NOT EXISTS).
--  ▸ شغّله مرة واحدة في:  Supabase ▸ SQL Editor ▸ Run.
--
--  بعد التشغيل: احذف ملفات الـ SQL القديمة من مشروعك واحتفظ بهذا فقط.
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════
-- 3) Row Level Security + سياسات السماح (anon key)
--     سياسة موحّدة "<table>_all" لكل جدول — idempotent.
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
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL USING (true) WITH CHECK (true);',
        t || '_all', t
      );
    END IF;
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 4) الفهارس (الأداء)
-- ══════════════════════════════════════════════════════════════════════════
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

-- ══════════════════════════════════════════════════════════════════════════
-- 5) Realtime — إضافة كل الجداول لمنشور supabase_realtime (idempotent)
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','menu_items','orders','tables','debts','expenses',
    'cash_log','receipts','comp_log','customers','shifts','loyalty_log',
    'app_settings','perm_overrides'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I;', t);
    END IF;
  END LOOP;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 6) بذور أولية (لا تكتب فوق بيانات موجودة)
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO app_settings   (id, data) VALUES ('main', '{}'::jsonb) ON CONFLICT (id) DO NOTHING;
INSERT INTO perm_overrides (id, data) VALUES ('main', '{}'::jsonb) ON CONFLICT (id) DO NOTHING;

-- ملاحظة: لا تُبذَر profiles هنا — التطبيق يرفع المستخدمين الافتراضيين
-- ويشفّر كلمات المرور (SHA-256) تلقائياً عند أول تشغيل.

-- ══════════════════════════════════════════════════════════════════════════
--  انتهى. الإصدار v8 — ملف موحّد نظيف.
-- ══════════════════════════════════════════════════════════════════════════
