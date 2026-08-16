// src/lib/dailyReport.js — v46
// ══════════════════════════════════════════════════════════════════════
// الجرد اليومي: البناء + قرار الإرسال + شبكة أمان التدوير
//
// ⚠ توضيح مهم: لا شيء «يُقفَل تلقائياً» عند حدّ اليوم.
//   • الورديات تُفتح وتُقفل يدوياً من الكاشير — لم يتغيّر شيء في ذلك.
//   • الساعة 0 غرينتش حدٌّ **حسابي** فقط: دفتر اليوم يُقفَل ويبدأ دفتر جديد.
//
// ══ ما تغيّر في v46 ══════════════════════════════════════════════════
// (١) نسبة الوردية لليوم صارت بوقت **الفتح** لا الإقفال.
//     دورة العمل الفعلية: صباحية ← مسائية ← ليلية، والليلية تُقفَل عند فتح
//     صباحية الغد. بالنسبة لوقت الإقفال كان «اليوم» = ليلةَ أمس + صباحَ
//     اليوم + مساءَ اليوم، وهو ليس يوم عمل. بالنسبة لوقت الفتح يصبح
//     صباحَ اليوم + مساءَ اليوم + ليلةَ اليوم — مطابقاً للواقع.
//
// (٢) شرط الإرسال لم يعد «أُقفلت وردية مسائية».
//     ذلك الشرط كان يقرأ shiftType، وهو عمود لم يكن موجوداً أصلاً في
//     قاعدة البيانات (أضافته هجرة v46)، فكان يُحذَف بصمت عند الكتابة
//     ويعود فارغاً من السحابة ⇒ الشرط false دائماً ⇒ الجرد لا يُرسَل.
//     الشرط الجديد وصفي لا اسمي: **يُرسَل حين تُقفَل آخر وردية في اليوم**
//     أياً كان نوعها، أي حين لا تبقى وردية مفتوحة تنتمي لذلك اليوم.
//     يعمل بنفس الكفاءة لو نسي الكاشير اختيار النوع، أو لو اختلف التسلسل
//     يوماً ما، أو لو عملت ورديتان فقط في يوم عطلة.
// ══════════════════════════════════════════════════════════════════════

import {
  businessDayKey, businessDayStart, formatDayKey,
  closedShiftsOfDay, openShiftsOfDay, shiftBusinessDay,
  sumShifts, ordersOfShifts, orderCogs,
} from "./utils.js";

// دمج ورديات إضافية (المُقفَلة للتوّ لم تصل store.shifts بعد) مع القائمة
const mergeShifts = (base, extra = []) => {
  const all = [...(base || [])];
  (extra || []).forEach(x => {
    const i = all.findIndex(s => s.id === x.id);
    if (i >= 0) all[i] = x; else all.push(x);
  });
  return all;
};

const typeLbl = (t) =>
  t === "morning" ? "صباحية" : t === "evening" ? "مسائية" : t === "night" ? "ليلية" : "؟";

// يبني حزمة الجرد اليومي من لقطات الورديات المُقفلة في ذلك اليوم.
// نعتمد لقطات الورديات لا نوافذ زمنية: الوردية الليلية تعبر حدّ اليوم،
// فحساب «كل ما دُفع منذ بداية اليوم» كان يُسقط جزءاً من إيرادها.
export const buildDailyPacket = (store, dayKey, extraShifts = []) => {
  const all = mergeShifts(store.shifts, extraShifts);

  const dayShifts = closedShiftsOfDay(all, dayKey, null);
  const agg = sumShifts(dayShifts);
  const paid = ordersOfShifts(store.orders, dayShifts)
    .filter(o => o.status === "paid" && !o.isComplimentary);
  const cogs = paid.reduce((s, o) => s + orderCogs(o, store.menu), 0);

  // v46: تسلسل ورديات اليوم كما جرى فعلاً — يظهر في التقرير فيكشف فوراً
  // أي يوم ناقص وردية (كان يمرّ سابقاً دون أن ينتبه أحد).
  const sequence = dayShifts.map(s => typeLbl(s.shiftType)).join(" ← ");

  return {
    dayKey,
    shiftsCount:  agg.shiftsCount,
    sequence,
    revenue:      agg.totalSales,
    cash:         agg.cashSales,
    card:         agg.cardSales,
    tron:         agg.tronSales,          // إكرامية نقدية: خارج الإيراد، داخل الدرج
    debtSettled:  agg.debtSettledCash,    // v46
    expenses:     agg.expensesTotal,
    secExpenses:  agg.secExpensesTotal,
    debts:        agg.debtTotal,
    comp:         agg.compTotal,
    cogs,
    profit:       agg.totalSales - cogs - agg.expensesTotal,
    orders:       agg.ordersCount,
    // v46: مطابقة الصندوق على مستوى اليوم — رقم إداري مهم كان غائباً تماماً
    expectedCash: agg.expectedCash,
    countedCash:  agg.countedCash,
    variance:     agg.difference,
    dayLabel:     `${formatDayKey(dayKey)} — ${agg.shiftsCount} وردية`,
  };
};

// مفتاح اليوم السابق لليوم المحاسبي الحالي
export const previousDayKey = (ref = new Date()) =>
  businessDayKey(new Date(businessDayStart(ref).getTime() - 1));

// هل انقضى هذا اليوم فعلاً؟ (لا نرسل جرد يوم ما زال جارياً)
export const dayIsOver = (dayKey, ref = new Date()) =>
  businessDayKey(ref) !== dayKey;

// ══════════════════════════════════════════════════════════════════════
// v46: هل اكتمل اليوم؟ — الشرط الوصفي البديل عن «الوردية المسائية»
// اليوم مكتمل حين: فيه وردية مُقفلة واحدة على الأقل، ولا وردية مفتوحة
// تنتمي إليه. الوردية الليلية تُفتح داخل اليوم وتُقفَل بعد حدّه، فتبقى
// «مفتوحة تنتمي لليوم» حتى تُقفَل — وعندها يكتمل اليوم فعلياً.
// ══════════════════════════════════════════════════════════════════════
export const dayIsComplete = (shifts, dayKey, extraShifts = []) => {
  if (!dayKey) return false;
  const all = mergeShifts(shifts, extraShifts);
  if (!closedShiftsOfDay(all, dayKey, null).length) return false;
  if (openShiftsOfDay(all, dayKey, null).length) return false;
  return true;
};

// ══════════════════════════════════════════════════════════════════════
// قرار الإرسال عند الإقفال — نقي وقابل للاختبار.
// يُرسَل جرد اليوم الذي تنتمي إليه الوردية المُقفَلة للتوّ، بشرط أن تكون
// آخر وردية فيه ولم يُرسَل جرده من قبل. يُعيد مفتاح اليوم أو null.
// ══════════════════════════════════════════════════════════════════════
export const shouldSendOnClose = (store, settings, closedShift) => {
  const dayKey = shiftBusinessDay(closedShift);
  if (!dayKey) return null;
  if ((settings?.lastDailySent || "") === dayKey) return null;
  if (!dayIsComplete(store.shifts, dayKey, [closedShift])) return null;
  return dayKey;
};

// ══════════════════════════════════════════════════════════════════════
// شبكة الأمان — تُفحَص دورياً عند الاتصال.
// إن لم يُرسَل جرد يومٍ ما (نسي الكاشير الإقفال، أو كان الجهاز مغلقاً)
// يُرسَل تلقائياً بعد انقضاء اليوم واكتماله. فلا يضيع جرد يوم أبداً.
// ══════════════════════════════════════════════════════════════════════
export const shouldSendDaily = (store, settings, dayKey, ref = new Date()) => {
  if (!dayKey) return false;
  if (!dayIsOver(dayKey, ref)) return false;
  if ((settings?.lastDailySent || "") === dayKey) return false;
  return dayIsComplete(store.shifts, dayKey);
};
