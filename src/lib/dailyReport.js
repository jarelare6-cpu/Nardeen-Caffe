// src/lib/dailyReport.js — v42
// ══════════════════════════════════════════════════════════════════════
// الجرد اليومي: البناء + شبكة أمان التدوير عند منتصف ليل غرينتش
//
// ⚠ توضيح مهم: لا شيء «يُقفَل تلقائياً» الساعة 0 غرينتش.
//   • الورديات تُفتح وتُقفل يدوياً من الكاشير — كما طلبتَ ولم يتغيّر.
//   • الساعة 0 UTC حدٌّ **حسابي**: دفتر اليوم يُقفَل ويبدأ دفتر جديد.
//     أي وردية تُقفَل بعد تلك اللحظة تُقيَّد في اليوم التالي.
//
// متى يُرسَل التقرير؟
//   المسار الأساسي: عند إقفال الوردية المسائية (~22:30 UTC) — وهي آخر
//   وردية تُقفَل في اليوم، فتكون الورديات الثلاث قد اكتملت:
//   الليلية (أُقفلت 06:00) + الصباحية (14:00) + المسائية (الآن).
//
//   شبكة الأمان (هذا الملف): إن لم يُرسَل تقرير يومٍ ما — نسي الكاشير
//   الإقفال، أو أُقفلت المسائية بعد منتصف ليل غرينتش، أو كان الجهاز
//   مغلقاً — يُرسَل تلقائياً بعد انقضاء اليوم عند أول اتصال.
//   فلا يضيع جرد يوم أبداً.
// ══════════════════════════════════════════════════════════════════════

import {
  businessDayKey, businessDayStart, businessDayEnd, formatDayKey,
  closedShiftsOfDay, sumShifts, ordersOfShifts, orderCogs,
} from "./utils.js";

// يبني حزمة الجرد اليومي من لقطات الورديات المُقفلة في ذلك اليوم.
// نعتمد لقطات الورديات لا نوافذ زمنية: الوردية الليلية تعبر منتصف ليل
// غرينتش، فحساب «كل ما دُفع منذ بداية اليوم» كان يُسقط جزءاً من إيرادها.
export const buildDailyPacket = (store, dayKey, extraShifts = []) => {
  const all = [...(store.shifts || [])];
  extraShifts.forEach(x => {
    const i = all.findIndex(s => s.id === x.id);
    if (i >= 0) all[i] = x; else all.push(x);
  });

  const dayShifts = closedShiftsOfDay(all, dayKey, null);
  const agg = sumShifts(dayShifts);
  const paid = ordersOfShifts(store.orders, dayShifts)
    .filter(o => o.status === "paid" && !o.isComplimentary);
  const cogs = paid.reduce((s, o) => s + orderCogs(o, store.menu), 0);

  return {
    dayKey,
    shiftsCount: agg.shiftsCount,
    revenue:     agg.totalSales,
    cash:        agg.cashSales,
    card:        agg.cardSales,
    tron:        agg.tronSales,
    expenses:    agg.expensesTotal,
    secExpenses: agg.secExpensesTotal,
    debts:       agg.debtTotal,
    comp:        agg.compTotal,
    cogs,
    profit:      agg.totalSales - cogs - agg.expensesTotal,
    orders:      agg.ordersCount,
    dayLabel:    `${formatDayKey(dayKey)} — ${agg.shiftsCount} وردية`,
  };
};

// مفتاح اليوم السابق لليوم المحاسبي الحالي
export const previousDayKey = (ref = new Date()) =>
  businessDayKey(new Date(businessDayStart(ref).getTime() - 1));

// هل انقضى هذا اليوم فعلاً؟ (لا نرسل جرد يوم ما زال جارياً)
export const dayIsOver = (dayKey, ref = new Date()) =>
  businessDayKey(ref) !== dayKey;

// قرار الإرسال — نقي وقابل للاختبار.
// يُرسَل فقط إذا: انقضى اليوم، ولم يُرسَل تقريره من قبل، وفيه ورديات مُقفلة،
// ولا توجد وردية من ذلك اليوم ما زالت مفتوحة (وإلا انتظرنا إقفالها).
export const shouldSendDaily = (store, settings, dayKey, ref = new Date()) => {
  if (!dayKey) return false;
  if (!dayIsOver(dayKey, ref)) return false;
  if ((settings?.lastDailySent || "") === dayKey) return false;

  const closed = closedShiftsOfDay(store.shifts, dayKey, null);
  if (!closed.length) return false;

  // وردية فُتحت قبل نهاية ذلك اليوم وما زالت مفتوحة ⇒ قد تُقيَّد فيه بعد
  // إقفالها. ننتظر بدل إرسال جرد ناقص.
  const dayEnd = businessDayEnd(new Date(`${dayKey}T12:00:00Z`)).getTime();
  const pending = (store.shifts || []).some(s =>
    s.status === "open" && s.openedAt && new Date(s.openedAt).getTime() < dayEnd);
  if (pending) return false;

  return true;
};
