-- ══════════════════════════════════════════════════════════════
-- v29: ترقيم فواتير متسلسل يُصفّر يومياً — عدّاد ذرّي عبر كل الأجهزة
-- الصيغة في التطبيق: YYYYMMDD-NNN  (مثل 20260612-001)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS invoice_counters (
  day text PRIMARY KEY,
  seq integer NOT NULL DEFAULT 0
);

ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_counters_all ON invoice_counters;
CREATE POLICY invoice_counters_all ON invoice_counters
  FOR ALL USING (true) WITH CHECK (true);

-- زيادة ذرّية: تُرجع الرقم التالي لليوم المعطى بلا تصادم بين الأجهزة
CREATE OR REPLACE FUNCTION next_invoice_seq(p_day text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE v integer;
BEGIN
  INSERT INTO invoice_counters(day, seq) VALUES (p_day, 1)
  ON CONFLICT (day) DO UPDATE SET seq = invoice_counters.seq + 1
  RETURNING seq INTO v;
  RETURN v;
END;
$$;
