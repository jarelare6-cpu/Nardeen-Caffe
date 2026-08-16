// src/lib/lock.js — v47 — القفل المحاسبي
// ══════════════════════════════════════════════════════════════════════
// المبدأ: بعد إرسال الجرد اليومي، يصبح ذلك اليوم **دفتراً مُقفلاً**.
// الأرقام غادرت النظام إلى تلغرام وإلى قرارات الإدارة، فأي تعديل صامت
// عليها بعد ذلك يجعل التقرير المُرسَل كذبةً موثّقة.
//
// القفل ليس منعاً مطلقاً — فالخطأ الحقيقي يجب أن يُصحَّح. القفل يفرض:
//   ١) الأدمن وحده يملك المفتاح.
//   ٢) لا تعديل بلا **سبب مكتوب** (10 أحرف على الأقل).
//   ٣) كل فتح قفل يُسجَّل في activity_log بالقيمة قبل/بعد.
// فيتحوّل التعديل من فعل صامت إلى أثر قابل للمراجعة.
//
// حدّ القفل: settings.lastDailySent يحمل مفتاح آخر يوم أُرسل جرده.
// مفاتيح الأيام بصيغة "YYYY-MM-DD" فالمقارنة النصية كافية ومطابقة
// للمقارنة الزمنية. إذن: كل يوم ≤ lastDailySent مُقفل.
// ══════════════════════════════════════════════════════════════════════

import { businessDayKey, shiftBusinessDay } from "./utils.js";

// الحدّ الأدنى لطول السبب — يمنع «تصحيح» و«خطأ» كأسباب بلا معنى
export const MIN_REASON_LEN = 10;

// اليوم المحاسبي الذي ينتمي إليه الطلب.
// الأولوية للوردية: هي وحدة الجرد الحقيقية، ولقطتها ثابتة. الطلب بلا
// وردية (بيانات قديمة) يُنسَب بوقته.
export const orderBusinessDay = (order, shifts) => {
  if (!order) return null;
  if (order.shiftId) {
    const sh = (shifts || []).find(s => s.id === order.shiftId);
    if (sh) return shiftBusinessDay(sh);
  }
  return businessDayKey(order.paidAt || order.createdAt);
};

// هل هذا اليوم مُقفل محاسبياً؟
export const isDayLocked = (dayKey, settings) => {
  const last = settings?.lastDailySent || "";
  if (!last || !dayKey) return false;
  return String(dayKey) <= String(last);
};

// هل هذا الطلب مُقفل؟
export const isOrderLocked = (order, shifts, settings) =>
  isDayLocked(orderBusinessDay(order, shifts), settings);

// نتيجة فحص الصلاحية — تُستعمل مباشرةً في الواجهة
//   allowed        : يمرّ التعديل بلا اعتراض
//   needsUnlock    : مُقفل والمستخدم أدمن ⇒ يُطلب سبب مكتوب
//   denied         : مُقفل والمستخدم ليس أدمن ⇒ يُرفض
export const checkOrderEdit = (order, { shifts, settings, user }) => {
  const dayKey = orderBusinessDay(order, shifts);
  if (!isDayLocked(dayKey, settings)) return { state: "allowed", dayKey };
  if (user?.role !== "admin") {
    return {
      state: "denied", dayKey,
      message: `🔒 يوم ${dayKey} مُقفل محاسبياً — أُرسل جرده. التعديل بصلاحية المدير فقط.`,
    };
  }
  return { state: "needsUnlock", dayKey };
};

// تحقّق من نصّ السبب قبل قبول التعديل
export const validateReason = (reason) => {
  const r = String(reason || "").trim();
  if (r.length < MIN_REASON_LEN) {
    return { ok: false, message: `اكتب سبباً واضحاً (${MIN_REASON_LEN} أحرف على الأقل) — يُحفظ في سجل النشاط.` };
  }
  return { ok: true, reason: r };
};

// وسم يُضاف على الطلب المُعدَّل بعد القفل — يبقى أثراً على الصفّ نفسه
// لا في السجل وحده، فيظهر في أي تصدير أو مراجعة لاحقة.
export const stampUnlockedEdit = (order, { user, reason, dayKey }) => ({
  ...order,
  lockedDayEdit: {
    at: new Date().toISOString(),
    by: user?.name || "",
    byId: user?.id || null,
    reason: String(reason || "").trim(),
    dayKey,
  },
});
