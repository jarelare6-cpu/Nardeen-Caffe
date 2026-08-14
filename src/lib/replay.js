// src/lib/replay.js — v45
// ══════════════════════════════════════════════════════════════════════
// منطق «إعادة تشغيل الوردية» و«كاشف الفاقد» — بلا أي واجهة.
//
// لماذا ملف مستقلّ؟ لأن هذا المنطق يجب أن يكون قابلاً للاختبار وحده
// (sim/replay_test.mjs)، وقابلاً لإعادة الاستخدام لاحقاً في تقرير تليجرام
// أو تصدير Excel بلا نسخ ولصق.
//
// مبدأ حاكم: **إشارتان دقيقتان خير من سبع تُطلق إنذارات كاذبة.**
// كل ما يُرفع هنا هو «يستحق النظر» لا «تهمة» — والصياغة في الواجهة تلتزم
// بذلك. مؤشّر يُهمَل لكثرة كذبه أسوأ من غياب المؤشّر.
// ══════════════════════════════════════════════════════════════════════

const ts = (v) => { const t = new Date(v).getTime(); return isNaN(t) ? null : t; };

// ── نافذة الوردية ──────────────────────────────────────────────────────
// وردية مفتوحة: النهاية = الآن. مقفلة: النهاية = closedAt.
export const shiftWindow = (shift) => {
  if (!shift) return null;
  const from = ts(shift.openedAt);
  if (from == null) return null;
  const to = shift.closedAt ? ts(shift.closedAt) : Date.now();
  return { from, to: to == null ? Date.now() : to, branch: shift.branch || "main" };
};

const inWin = (t, w) => t != null && t >= w.from && t <= w.to;

// ══════════════════════════════════════════════════════════════════════
// 1) الخط الزمني
// ══════════════════════════════════════════════════════════════════════
// المصدر هو activity_log وحده — لا ندمج مصادر متعدّدة لأن الدمج يُنتج
// تكراراً (الطلب يظهر مرة من الجدول ومرة من السجل) وترتيباً مضطرباً.
// نرتّب على server_at إن وُجد (ساعة الخادم)، وإلا على created_at.
export const rowTime = (r) => ts(r.server_at) ?? ts(r.created_at);

// انحراف ساعة الجهاز عن ساعة الخادم — يُعرَض كتحذير لا كاتهام.
export const clockSkewMs = (r) => {
  const s = ts(r.server_at), c = ts(r.created_at);
  return (s == null || c == null) ? 0 : Math.abs(s - c);
};

export const buildTimeline = (activity, shift) => {
  const w = shiftWindow(shift);
  if (!w) return [];
  return (activity || [])
    .filter(r => (r.branch || "main") === w.branch && inWin(rowTime(r), w))
    .sort((a, b) => rowTime(a) - rowTime(b));
};

// ══════════════════════════════════════════════════════════════════════
// 2) البطاقات الثلاث
// ══════════════════════════════════════════════════════════════════════
export const buildSummary = (orders, shift) => {
  const w = shiftWindow(shift);
  const empty = { cancels: 0, cancelValue: 0, discountValue: 0, difference: 0, ordersCount: 0 };
  if (!w) return empty;

  const inShift = (orders || []).filter(o => {
    if ((o.branch || "main") !== w.branch) return false;
    // الطلب يخصّ الوردية إن نُسب إليها صراحةً، أو أُنشئ داخل نافذتها.
    if (o.shiftId && shift.id) return o.shiftId === shift.id;
    return inWin(ts(o.createdAt), w);
  });

  const cancelled = inShift.filter(o => o.status === "cancelled");
  const discountValue = inShift.reduce((s, o) => {
    const orig = +o.originalTotal || 0;
    return s + (orig > 0 ? Math.max(0, orig - (+o.total || 0)) : 0);
  }, 0);

  return {
    cancels: cancelled.length,
    cancelValue: cancelled.reduce((s, o) => s + (+o.total || +o.originalTotal || 0), 0),
    discountValue,
    difference: +shift?.difference || 0,
    ordersCount: inShift.length,
  };
};

// ══════════════════════════════════════════════════════════════════════
// 3) الإشارتان
// ══════════════════════════════════════════════════════════════════════
// (أ) إلغاء بعد الجاهزية — الحيلة الكلاسيكية: يُحضَّر ويُقدَّم ثم يُلغى.
//     نعتمد على readyAt المخزّن في الطلب، لا على نصّ السجل.
// (ب) إلغاء سريع (< 60 ثانية من الإنشاء) — يقابل غالباً خطأ إدخال بريئاً،
//     لذا نصنّفه «منخفض» ونعرضه للسياق لا للإنذار.
export const QUICK_CANCEL_MS = 60_000;

export const detectSignals = (orders, shift) => {
  const w = shiftWindow(shift);
  if (!w) return [];
  const out = [];

  (orders || []).forEach(o => {
    if (o.status !== "cancelled") return;
    if ((o.branch || "main") !== w.branch) return;
    const created = ts(o.createdAt);
    if (o.shiftId && shift.id ? o.shiftId !== shift.id : !inWin(created, w)) return;

    const ready = ts(o.readyAt);
    if (ready != null) {
      out.push({
        level: "high",
        kind: "cancel_after_ready",
        orderNum: o.orderNum,
        at: ready,
        amount: +o.total || +o.originalTotal || 0,
        title: "إلغاء بعد أن صار الطلب جاهزاً",
        why: "الطلب وُسم «جاهز» ثم أُلغي — أي أنه حُضِّر فعلاً. يستحق النظر في وجهة البضاعة.",
        reason: o.cancelReason || "",
      });
      return; // لا نرفع إشارتين لنفس الطلب
    }

    const cancelledAt = ts(o.updatedAt);
    if (created != null && cancelledAt != null && cancelledAt - created < QUICK_CANCEL_MS) {
      out.push({
        level: "low",
        kind: "quick_cancel",
        orderNum: o.orderNum,
        at: cancelledAt,
        amount: +o.total || 0,
        title: "إلغاء سريع (أقل من دقيقة)",
        why: "غالباً خطأ إدخال عادي. يُعرَض للسياق فقط.",
        reason: o.cancelReason || "",
      });
    }
  });

  return out.sort((a, b) => (a.level === b.level ? a.at - b.at : a.level === "high" ? -1 : 1));
};

// ══════════════════════════════════════════════════════════════════════
// 4) كاشف الفاقد
// ══════════════════════════════════════════════════════════════════════
// لا يراقب موظفاً — يراقب البضاعة. يكشف الشيء الوحيد الذي لا تكشفه أي
// مراقبة: الصنف الذي خرج من المخزن ولم يُسجَّل بيعه أصلاً.
//
// المصدر: حركات reason="correction" (تصحيح جرد) في stock_movements.
// كل جرد دوري يكتب فارقاً؛ الفارق السالب = نقص وجدناه على الرف.
//
// المنطق: **النقص العشوائي طبيعي، والمتكرّر إشارة.** لذلك نعدّ مرّات
// النقص ومرّات الزيادة معاً: صنف يتأرجح صعوداً وهبوطاً هو خطأ قياس،
// وصنف ينقص مرة بعد مرة ولا يزيد أبداً هو شيء آخر.
export const WASTE_MIN_TIMES = 2;

export const buildWasteReport = (stockMoves, { days = 90, menu = [] } = {}) => {
  const since = Date.now() - days * 86400000;
  const byItem = new Map();

  (stockMoves || []).forEach(m => {
    if (m.reason !== "correction") return;
    const t = ts(m.at);
    if (t == null || t < since) return;
    const key = m.itemId || m.itemName;
    if (!key) return;

    if (!byItem.has(key)) {
      byItem.set(key, {
        itemId: m.itemId, itemName: m.itemName || "—", kind: m.kind || "menu",
        shortTimes: 0, overTimes: 0, shortQty: 0, overQty: 0, lastAt: t,
      });
    }
    const r = byItem.get(key);
    const d = +m.delta || 0;
    if (d < 0) { r.shortTimes++; r.shortQty += Math.abs(d); }
    else if (d > 0) { r.overTimes++; r.overQty += d; }
    if (t > r.lastAt) r.lastAt = t;
  });

  const costOf = (id) => +(menu.find(x => x.id === id)?.cost) || 0;

  return Array.from(byItem.values())
    .map(r => {
      const net = r.overQty - r.shortQty;              // سالب = نقص صافٍ
      const persistent = r.shortTimes >= WASTE_MIN_TIMES && net < 0 && r.shortTimes > r.overTimes;
      return {
        ...r,
        net,
        lossValue: net < 0 ? Math.abs(net) * costOf(r.itemId) : 0,
        // متكرّر ومتّجه في اتجاه واحد ⇒ يستحقّ النظر
        flagged: persistent,
        note: persistent
          ? "نقص متكرّر في اتجاه واحد — يستحقّ النظر"
          : (r.overTimes && r.shortTimes ? "يتأرجح صعوداً وهبوطاً — الأرجح خطأ قياس" : "ضمن الطبيعي"),
      };
    })
    .sort((a, b) => (b.flagged - a.flagged) || (b.lossValue - a.lossValue) || (b.shortTimes - a.shortTimes));
};
