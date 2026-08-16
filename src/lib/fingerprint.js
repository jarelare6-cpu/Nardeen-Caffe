// src/lib/fingerprint.js — v48 — بصمة الوردية
// ══════════════════════════════════════════════════════════════════════
// المشكلة التي تحلّها:
//   الوردية تُقفَل ويُوقّع الكاشير على أرقامها، ثم يبقى الماضي قابلاً
//   للتعديل: أدمن يفتح القفل المحاسبي، أو جهاز متأخّر المزامنة يكتب فوق
//   طلب، أو تعديل يدوي في القاعدة. بعد أسبوع لا أحد يعرف: هل هذه الأرقام
//   هي التي أُقفلت عليها الوردية فعلاً، أم تغيّرت بعدها؟
//   لا يوجد اليوم أي وسيلة للإجابة — إلا الظنّ.
//
// الحل: بصمة تشفيرية (SHA-256) تُحسَب لحظة الإقفال على محتوى الوردية،
// وتُخزَّن مع الوردية. في أي وقت لاحق يُعاد الحساب ويُقارَن:
//   • تطابق  ⇒ إثبات رياضي أن شيئاً لم يُمسّ منذ الإقفال.
//   • اختلاف ⇒ إثبات قاطع أن شيئاً تغيّر — مع تحديد **أي جزء** تغيّر.
//
// لماذا بصمات جزئية لا بصمة واحدة؟
//   بصمة واحدة تقول «تغيّر شيء» وهذا نصف الجواب. أربع بصمات (الطلبات،
//   الصندوق، المصاريف، المخزون) تقول «تغيّرت الطلبات والصندوق سليم» —
//   فتذهب مباشرةً إلى موضع الخلل بدل تفتيش الوردية كلها.
//
// ملاحظة أمنية صريحة: هذه بصمة **كاشفة للتغيير** لا مانعة له، ولا توقيع
// رقمي. مَن يملك صلاحية الكتابة على القاعدة يستطيع إعادة حساب البصمة.
// قيمتها في كشف التعديل العَرَضي وغير الموثَّق — وهو 99٪ مما يحدث فعلاً.
// ══════════════════════════════════════════════════════════════════════

const enc = (s) => new TextEncoder().encode(s);

// SHA-256 → 16 حرفاً hex (64 بت). كافٍ تماماً هنا: الغرض كشف تغيير لا
// مقاومة تصادم خصومي، والعرض القصير يجعل المقارنة البصرية ممكنة.
const sha = async (text) => {
  try {
    const buf = await crypto.subtle.digest("SHA-256", enc(text));
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch {
    return null; // بيئة بلا crypto.subtle (http غير آمن) — نُعطّل البصمة بهدوء
  }
};

const n2 = (v) => Math.round((+v || 0) * 100) / 100; // تطبيع الأرقام: منع اختلاف الفواصل العشرية

// ── المكوّنات: كل واحد نصّ حتمي مرتّب، فلا يتغيّر بترتيب المصفوفة ──

// الطلبات: المعرّف + الحالة + الإجمالي + نوع الدفع + الترون + الضيافة.
// نستثني حقول العرض (الملاحظات، أسماء الموظفين) لأن تصحيحها ليس تلاعباً.
export const ordersDigestText = (orders) =>
  (orders || [])
    .map(o => [o.id, o.status, n2(o.total), o.paymentType || "", n2(o.tronAmount), n2(o.compAmount)].join("|"))
    .sort()
    .join("\n");

export const cashDigestText = (shift) =>
  [
    n2(shift?.openingCash), n2(shift?.cashSales), n2(shift?.cardSales),
    n2(shift?.tronSales), n2(shift?.debtSettledCash), n2(shift?.expensesTotal),
    n2(shift?.expectedCash), n2(shift?.countedCash), n2(shift?.difference),
    n2(shift?.totalSales), n2(shift?.debtTotal), n2(shift?.compTotal),
    shift?.ordersCount ?? 0,
  ].join("|");

export const expensesDigestText = (expenses) =>
  (expenses || [])
    .map(e => [e.id, n2(e.amount), e.category || "", e.isSecondary ? "s" : "p"].join("|"))
    .sort()
    .join("\n");

export const stockDigestText = (moves) =>
  (moves || [])
    .map(m => [m.id, m.itemId, n2(m.delta), m.reason || ""].join("|"))
    .sort()
    .join("\n");

// ── جمع عناصر الوردية من المتجر (نقي: يأخذ مصفوفات ويُرجع مصفوفات) ──
export const collectShiftParts = (shift, { orders, expenses, stockMoves }) => {
  const sid = shift?.id;
  const from = shift?.openedAt ? new Date(shift.openedAt).getTime() : 0;
  const to = shift?.closedAt ? new Date(shift.closedAt).getTime() : Date.now();
  const branch = shift?.branch || "main";
  const inWin = (iso) => { const t = iso ? new Date(iso).getTime() : NaN; return t >= from && t <= to; };

  return {
    orders: (orders || []).filter(o =>
      (o.branch || "main") === branch &&
      (o.shiftId ? o.shiftId === sid : inWin(o.paidAt || o.createdAt))),
    expenses: (expenses || []).filter(e =>
      (e.branch || "main") === branch &&
      (e.shiftId ? e.shiftId === sid : inWin(e.date))),
    stockMoves: (stockMoves || []).filter(m => m.shiftId === sid),
  };
};

// ── حساب البصمة الكاملة ──
export const computeShiftFingerprint = async (shift, sources) => {
  const parts = collectShiftParts(shift, sources);
  const [orders, cash, expenses, stock] = await Promise.all([
    sha(ordersDigestText(parts.orders)),
    sha(cashDigestText(shift)),
    sha(expensesDigestText(parts.expenses)),
    sha(stockDigestText(parts.stockMoves)),
  ]);
  if (!orders) return null; // crypto غير متاح
  const all = await sha([orders, cash, expenses, stock].join("~"));
  return {
    v: 1,
    all, orders, cash, expenses, stock,
    counts: {
      orders: parts.orders.length,
      expenses: parts.expenses.length,
      stock: parts.stockMoves.length,
    },
    at: new Date().toISOString(),
  };
};

// ── التحقّق: يُعيد أي المكوّنات تغيّر ──
export const LABELS = {
  orders:   "الطلبات",
  cash:     "أرقام الصندوق",
  expenses: "المصاريف",
  stock:    "حركات المخزون",
};

export const verifyShiftFingerprint = async (shift, sources) => {
  const stored = shift?.fingerprint;
  if (!stored || !stored.all) return { state: "none" };       // وردية أُقفلت قبل v48
  const now = await computeShiftFingerprint(shift, sources);
  if (!now) return { state: "unavailable" };                   // crypto غير متاح

  if (now.all === stored.all) return { state: "intact", stored, now };

  const changed = ["orders", "cash", "expenses", "stock"]
    .filter(k => stored[k] !== now[k])
    .map(k => ({
      key: k,
      label: LABELS[k],
      before: stored.counts?.[k] ?? null,
      after: now.counts?.[k] ?? null,
    }));

  return { state: "changed", stored, now, changed };
};
