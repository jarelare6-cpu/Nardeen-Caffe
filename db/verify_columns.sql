-- ════════════════════════════════════════════════════════════════
-- استعلام التحقّق الشامل — يقارن الأعمدة التي يكتبها الكود بأعمدة قاعدتك الحيّة
-- يُظهر فقط الأعمدة الناقصة (التي يكتبها الكود وغير موجودة في جدولك)
-- شغّله مرة واحدة في Supabase → SQL Editor. إن رجع صفر صفوف = كل شيء سليم.
-- ════════════════════════════════════════════════════════════════
WITH expected(table_name, column_name) AS (
  VALUES
  -- comp_log (الضيافة / مشروب العامل)
  ('comp_log','id'),('comp_log','order_id'),('comp_log','order_num'),('comp_log','customer_name'),
  ('comp_log','table_num'),('comp_log','items'),('comp_log','amount'),('comp_log','reason'),
  ('comp_log','created_by'),('comp_log','created_at'),('comp_log','branch'),
  -- customers (الزبائن / الولاء)
  ('customers','id'),('customers','name'),('customers','phone'),('customers','email'),
  ('customers','visits'),('customers','total_orders'),('customers','total_spent'),('customers','notes'),
  ('customers','loyalty_points'),('customers','loyalty_redeemed'),('customers','tier'),
  ('customers','created_at'),('customers','last_visit'),('customers','orders'),
  -- debts (الديون)
  ('debts','id'),('debts','order_id'),('debts','order_num'),('debts','customer_name'),
  ('debts','amount'),('debts','remaining'),('debts','date'),('debts','settled'),
  ('debts','settled_at'),('debts','notes'),('debts','created_by'),
  -- expenses (المصاريف)
  ('expenses','id'),('expenses','amount'),('expenses','category'),('expenses','description'),
  ('expenses','label'),('expenses','notes'),('expenses','date'),('expenses','is_secondary'),
  ('expenses','is_complimentary'),('expenses','order_id'),('expenses','order_num'),
  ('expenses','by'),('expenses','created_by'),
  -- loyalty_log (سجل الولاء)
  ('loyalty_log','id'),('loyalty_log','customer_id'),('loyalty_log','customer_name'),
  ('loyalty_log','type'),('loyalty_log','points'),('loyalty_log','order_id'),
  ('loyalty_log','order_num'),('loyalty_log','note'),('loyalty_log','created_by'),('loyalty_log','created_at'),
  -- receipts (الفواتير)
  ('receipts','id'),('receipts','order_id'),('receipts','order_num'),('receipts','customer_name'),
  ('receipts','table_num'),('receipts','items'),('receipts','total'),('receipts','discount'),
  ('receipts','tron_amount'),('receipts','payment_type'),('receipts','notes'),('receipts','cafe_name'),
  ('receipts','created_by'),('receipts','created_at'),('receipts','branch'),
  -- shifts (الورديات)
  ('shifts','id'),('shifts','user_id'),('shifts','user_name'),('shifts','branch'),
  ('shifts','opened_at'),('shifts','closed_at'),('shifts','opening_cash'),('shifts','counted_cash'),
  ('shifts','expected_cash'),('shifts','difference'),('shifts','cash_sales'),('shifts','card_sales'),
  ('shifts','tron_sales'),('shifts','debt_total'),('shifts','comp_total'),('shifts','total_sales'),
  ('shifts','expenses_total'),('shifts','orders_count'),('shifts','status'),('shifts','notes'),
  ('shifts','created_at'),('shifts','shift_type')
)
SELECT e.table_name AS "الجدول", e.column_name AS "العمود الناقص"
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_name = e.table_name
 AND c.column_name = e.column_name
 AND c.table_schema = 'public'
WHERE c.column_name IS NULL
ORDER BY e.table_name, e.column_name;
