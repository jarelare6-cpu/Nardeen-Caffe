// src/lib/rows.js — مُسلسِلات/محوِّلات نقية (بلا React/Supabase) قابلة للاختبار
// مشتركة بين التطبيق (store.js) واختبارات التكامل (sim/).

export const rowOfCash = (e) => ({
  id: e.id, order_id: e.orderId || null,
  order_num: e.orderNum || "", amount: e.amount,
  at: e.at, by: e.by || "", type: e.type || "sale",
  branch: e.branch || "main",
});

export const rowOfExpense = (e) => ({
  id: e.id, label: e.label || e.description || "",
  description: e.description || e.label || "",
  amount: e.amount, category: e.category || "other",
  date: e.date, by: e.by || e.createdBy || "",
  created_by: e.createdBy || e.by || "",
  notes: e.notes || "", is_secondary: e.isSecondary || false,
  order_id: e.orderId || null, order_num: e.orderNum || "",
  is_complimentary: e.isComplimentary || false,
  shift_id: e.shiftId || null, // v4.7.0: ربط المصروف بالوردية
});
// fallback لقاعدة لم تُرقَّ بعد (لا عمود shift_id) — يمنع فشل الكتابة واختفاء البيانات
export const rowOfExpenseLegacy = (e) => { const { shift_id, ...r } = rowOfExpense(e); return r; };

export const rowOfOrder = (o) => ({
  id: o.id, order_num: o.orderNum,
  customer_name: o.customerName, customer_id: o.customerId || null,
  table_num: o.table || "", items: o.items,
  total: o.total, discount: o.discount || 0,
  status: o.status, payment_type: o.paymentType || "cash",
  payment_status: o.paymentStatus || "pending",
  partial_paid: o.partialPaid || 0,
  notes: o.notes || "", created_at: o.createdAt,
  paid_at: o.paidAt || null, paid_by: o.paidBy || null,
  paid_by_name: o.paidByName || "",
  is_debt_settlement: o.isDebtSettlement || false,
  original_total: o.originalTotal || null,
  comp_amount: o.compAmount || 0,
  is_complimentary: o.isComplimentary || false,
  worker_name: o.workerName || "",
  tron_amount: o.tronAmount || 0,
  branch: o.branch || "main",
  shift_id: o.shiftId || null,
  preparing_at: o.preparingAt || null,
  ready_at: o.readyAt || null,
  stock_deducted: o.stockDeducted !== false, // v23
  updated_at: o.updatedAt || new Date().toISOString(), // v4.7.0: حلّ تعارض المزامنة
});
// fallback لقاعدة لم تُرقَّ (لا stock_deducted/updated_at)
export const rowOfOrderLegacy = (o) => { const { stock_deducted, updated_at, ...r } = rowOfOrder(o); return r; };

export const mapOrder = o => ({
  ...o,
  orderNum:     o.order_num     ?? o.orderNum     ?? "",
  customerName: o.customer_name ?? o.customerName ?? "زبون",
  customerId:   o.customer_id   ?? o.customerId   ?? null,
  table:        o.table_num     ?? o.table        ?? "",
  paymentType:  o.payment_type  ?? o.paymentType  ?? "cash",
  paymentStatus:o.payment_status?? o.paymentStatus?? "pending",
  partialPaid:  o.partial_paid  ?? o.partialPaid  ?? 0,
  createdAt:    o.created_at    ?? o.createdAt    ?? new Date().toISOString(),
  paidAt:       o.paid_at       ?? o.paidAt       ?? null,
  paidBy:       o.paid_by       ?? o.paidBy       ?? null,
  paidByName:   o.paid_by_name  ?? o.paidByName   ?? "",
  isDebtSettlement: o.is_debt_settlement ?? o.isDebtSettlement ?? false,
  originalTotal: o.original_total ?? o.originalTotal ?? null,
  compAmount:   o.comp_amount   ?? o.compAmount   ?? 0,
  isComplimentary: o.is_complimentary ?? o.isComplimentary ?? false,
  workerName:   o.worker_name   ?? o.workerName   ?? "",
  tronAmount:   o.tron_amount   ?? o.tronAmount   ?? 0,
  branch:       o.branch        ?? "main",
  shiftId:      o.shift_id      ?? o.shiftId      ?? null,
  preparingAt:  o.preparing_at  ?? o.preparingAt  ?? null,
  readyAt:      o.ready_at       ?? o.readyAt      ?? null,
  stockDeducted: (o.stock_deducted ?? o.stockDeducted) !== false, // v23: القديم = true
  updatedAt:    o.updated_at    ?? o.updatedAt    ?? null, // v4.7.0
});

export const mapExpense = e => ({
  ...e,
  description:  e.description ?? e.label ?? "",
  label:        e.label ?? e.description ?? "",
  createdBy:    e.created_by ?? e.createdBy ?? e.by ?? "",
  by:           e.by ?? e.created_by ?? e.createdBy ?? "",
  isSecondary:  e.is_secondary ?? e.isSecondary ?? false,
  orderId:      e.order_id ?? e.orderId ?? null,
  orderNum:     e.order_num ?? e.orderNum ?? "",
  isComplimentary: e.is_complimentary ?? e.isComplimentary ?? false,
  shiftId:      e.shift_id ?? e.shiftId ?? null, // v4.7.0
});

// v38: استخراج اسم العمود الناقص من رسالة خطأ Postgres/PostgREST (نقي، قابل للاختبار)
export const extractMissingCol = (msg) => {
  if (!msg) return null;
  const m = msg.match(/the '([^']+)' column/i) || msg.match(/'([^']+)' column/i) ||
            msg.match(/column "([^"]+)"/i) || msg.match(/column ([a-z_]+) of/i);
  return m ? m[1] : null;
};
