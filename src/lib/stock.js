// ══════════════════════════════════════════════════════════════
// v23: خصم المخزون عند الدفع/التسليم (لا عند إنشاء الطلب)
// ──────────────────────────────────────────────────────────────
// القاعدة:
//  • إنشاء الطلب: لا خصم — يُوسم stockDeducted:false
//  • الخصم عند أول حالة نهائية تعني تسليم البضاعة:
//      دفع كامل / دفع جزئي / دين / ضيافة كاملة
//  • الإلغاء: إرجاع المخزون فقط إن كان قد خُصم (طلبات النظام القديم)
//  • الطلبات القديمة (قبل v23): stockDeducted غير معرّف → تُعامل TRUE
//    (خُصمت عند الإنشاء) فلا يحدث خصم مزدوج ولا فقدان إرجاع.
// ══════════════════════════════════════════════════════════════

// هل خُصم مخزون هذا الطلب؟ (undefined/null = طلب قديم = نعم)
export const isStockDeducted = (order) => order?.stockDeducted !== false;

// خصم مخزون أصناف الطلب (إن لم يُخصم بعد) — يعيد الطلب موسوماً
export const deductOrderStock = (store, order) => {
  if (!order || isStockDeducted(order)) return order;
  const items = order.items || [];
  if (items.length) {
    store.setMenu(p => p.map(m => {
      if (m.noStock || m.trackStock === false) return m; // v24 خدمي / v28 مخزون مفتوح: لا يُخصم
      const ci = items.find(c => c.itemId === m.id);
      if (!ci) return m;
      return {
        ...m,
        stock: Math.max(0, (m.stock || 0) - ci.qty),
        totalSold: (m.totalSold || 0) + ci.qty,
      };
    }));
  }
  return { ...order, stockDeducted: true };
};

// إرجاع مخزون أصناف الطلب — فقط إن كان قد خُصم فعلاً
export const restoreOrderStock = (store, order) => {
  if (!order || !isStockDeducted(order)) return false;
  const items = order.items || [];
  if (items.length) {
    store.setMenu(p => p.map(m => {
      if (m.noStock || m.trackStock === false) return m; // v24 خدمي / v28 مخزون مفتوح: لا يُرجَّع
      const ci = items.find(c => c.itemId === m.id);
      if (!ci) return m;
      return {
        ...m,
        stock: (m.stock || 0) + ci.qty,
        totalSold: Math.max(0, (m.totalSold || 0) - ci.qty),
      };
    }));
  }
  return true;
};
