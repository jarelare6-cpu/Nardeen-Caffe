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
    worker_name, tron_amount, branch, shift_id, preparing_at, ready_at
  )
  SELECT
    x.id, x.order_num, x.customer_name, x.customer_id, x.table_num, x.items,
    x.total, x.discount, x.status, x.payment_type, x.payment_status, x.partial_paid,
    x.notes, x.created_at, x.paid_at, x.paid_by, x.paid_by_name,
    x.is_debt_settlement, x.original_total, x.comp_amount, x.is_complimentary,
    x.worker_name, x.tron_amount, x.branch, x.shift_id, x.preparing_at, x.ready_at
  FROM jsonb_to_record(p_order) AS x(
    id text, order_num text, customer_name text, customer_id text, table_num text, items jsonb,
    total numeric, discount numeric, status text, payment_type text, payment_status text, partial_paid numeric,
    notes text, created_at timestamptz, paid_at timestamptz, paid_by text, paid_by_name text,
    is_debt_settlement boolean, original_total numeric, comp_amount numeric, is_complimentary boolean,
    worker_name text, tron_amount numeric, branch text, shift_id text, preparing_at timestamptz, ready_at timestamptz
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
    shift_id       = EXCLUDED.shift_id;

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
