// src/lib/stockLog.js — v42
// ══════════════════════════════════════════════════════════════════════
// طبقة المخزون: المواد الإضافية (supplies) + سجل الحركات (stock_movements)
//
// لماذا هذا الملف؟
//  • كانت المواد داخل settings.extraStock — حقل JSONB واحد. أي تعديل يكتب
//    المصفوفة كاملة، فجهازان يعدّلان معاً ⇒ آخر كتابة تمحو الأخرى بصمت.
//  • وكانت تغيّرات المخزون بلا أثر: لا نعرف من أضاف ولا كم ولا متى.
//
// المبدأ الحاكم: **نرسل الفارق لا القيمة**. القاعدة تُجري (qty = qty + delta)
// على الصف المقفول، فيستحيل ضياع تحديث مهما تزامنت الأجهزة.
// ══════════════════════════════════════════════════════════════════════

export const MOVE_REASONS = {
  restock:    "توريد",
  sale:       "بيع",
  waste:      "تلف",
  correction: "تصحيح جرد",
  comp:       "ضيافة",
  return:     "إرجاع",
};

export const reasonLabel = (r) => MOVE_REASONS[r] || r || "—";

export const newMoveId = () =>
  "mv_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const newSupplyId = () =>
  "sup_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ── مُحوِّلات الصفوف ────────────────────────────────────────────────────
export const rowOfSupply = (s) => ({
  id: s.id,
  name: s.name || "",
  unit: s.unit || "",
  qty: Math.max(0, +s.qty || 0),
  min_stock: Math.max(0, +s.minStock || 0),
  branch: s.branch || "main",
  active: s.active !== false,
  updated_at: new Date().toISOString(),
});

export const mapSupply = (r) => ({
  id: r.id,
  name: r.name ?? "",
  unit: r.unit ?? "",
  qty: +(r.qty ?? 0),
  minStock: +(r.min_stock ?? r.minStock ?? 0),
  branch: r.branch ?? "main",
  active: (r.active ?? true) !== false,
  createdAt: r.created_at ?? r.createdAt ?? null,
  updatedAt: r.updated_at ?? r.updatedAt ?? null,
});

export const rowOfMovement = (m) => ({
  id: m.id,
  kind: m.kind || "menu",
  item_id: m.itemId,
  item_name: m.itemName || "",
  delta: +m.delta || 0,
  qty_after: m.qtyAfter == null ? null : +m.qtyAfter,
  reason: m.reason || "restock",
  order_id: m.orderId || null,
  order_num: m.orderNum || "",
  user_id: m.userId || null,
  user_name: m.userName || "",
  user_role: m.userRole || "",
  shift_id: m.shiftId || null,
  branch: m.branch || "main",
  note: m.note || "",
  at: m.at || new Date().toISOString(),
});

export const mapMovement = (r) => ({
  id: r.id,
  kind: r.kind ?? "menu",
  itemId: r.item_id ?? r.itemId,
  itemName: r.item_name ?? r.itemName ?? "",
  delta: +(r.delta ?? 0),
  qtyAfter: r.qty_after == null ? null : +r.qty_after,
  reason: r.reason ?? "restock",
  orderId: r.order_id ?? r.orderId ?? null,
  orderNum: r.order_num ?? r.orderNum ?? "",
  userId: r.user_id ?? r.userId ?? null,
  userName: r.user_name ?? r.userName ?? "",
  userRole: r.user_role ?? r.userRole ?? "",
  shiftId: r.shift_id ?? r.shiftId ?? null,
  branch: r.branch ?? "main",
  note: r.note ?? "",
  at: r.at ?? new Date().toISOString(),
});

// ── ترحيل المواد القديمة من settings.extraStock ────────────────────────
// يُستدعى مرة واحدة عند أول تحميل يجد الجدول فارغاً والحقل القديم عامراً.
// لا يمسّ settings.extraStock — يبقى نسخة احتياطية قابلة للمراجعة.
export const migrateExtraStock = (extraStock) =>
  (extraStock || [])
    .filter(s => s && (s.name || "").trim())
    .map(s => ({
      id: s.id || newSupplyId(),
      name: String(s.name).trim(),
      unit: s.unit || "",
      qty: Math.max(0, +s.qty || 0),
      minStock: Math.max(0, +s.minStock || 0),
      branch: "main",
      active: true,
    }));

// ── تجميع الحركات لتقرير ───────────────────────────────────────────────
export const summarizeMovements = (moves, { from, to, kind, itemId, reason, userName } = {}) => {
  const f = from ? new Date(from).getTime() : -Infinity;
  const t = to ? new Date(to).getTime() : Infinity;
  const list = (moves || []).filter(m => {
    const ts = new Date(m.at).getTime();
    if (!(ts >= f && ts <= t)) return false;
    if (kind && m.kind !== kind) return false;
    if (itemId && m.itemId !== itemId) return false;
    if (reason && m.reason !== reason) return false;
    if (userName && m.userName !== userName) return false;
    return true;
  });
  const added = list.filter(m => m.delta > 0).reduce((a, m) => a + m.delta, 0);
  const removed = list.filter(m => m.delta < 0).reduce((a, m) => a + Math.abs(m.delta), 0);
  return { list, count: list.length, added, removed, net: added - removed };
};
