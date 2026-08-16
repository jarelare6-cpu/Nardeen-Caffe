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
export const dayIsComplete = (shifts, dayKey, extraShifts = [], ref = new Date()) => {
  if (!dayKey) return false;

  // ══════════════════════════════════════════════════════════════════
  // v47.1 — الشرط الحاسم: **اليوم المحاسبي انقضى فعلاً**
  // ──────────────────────────────────────────────────────────────────
  // بدونه كان يقع عطل الإرسال المبكّر: عند إقفال الوردية المسائية
  // (~19:00 غرينتش) لم تكن الليلية قد فُتحت بعد، فتمرّ دقائق لا توجد
  // فيها وردية مفتوحة تخصّ اليوم — فيبدو اليوم «مكتملاً» ويُرسَل جرده
  // ناقصاً الوردية الليلية كاملةً، ثم يُختم فلا يُعاد إرساله أبداً.
  //
  // مع هذا الشرط: الليلية تُقفَل ~03:00 غرينتش من الغد، أي بعد انقضاء
  // اليوم، فيُرسَل الجرد عند إقفالها وهو التوقيت الصحيح تماماً.
  // والفجوة بين المسائية والليلية تقع داخل اليوم الجاري ⇒ لا إرسال.
  // ══════════════════════════════════════════════════════════════════
  if (businessDayKey(ref) === dayKey) return false;

  const all = mergeShifts(shifts, extraShifts);
  if (!closedShiftsOfDay(all, dayKey, null).length) return false;
  // وردية من ذلك اليوم ما زالت مفتوحة ⇒ ننتظر إقفالها بدل جرد ناقص
  if (openShiftsOfDay(all, dayKey, null).length) return false;
  return true;
};

// ══════════════════════════════════════════════════════════════════════
// قرار الإرسال عند الإقفال — نقي وقابل للاختبار.
// يُرسَل جرد اليوم الذي تنتمي إليه الوردية المُقفَلة للتوّ، بشرط أن تكون
// آخر وردية فيه ولم يُرسَل جرده من قبل. يُعيد مفتاح اليوم أو null.
// ══════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════
// v48 — الختم أحادي الاتجاه
// ──────────────────────────────────────────────────────────────────────
// كان الفحص `lastDailySent === dayKey`، وهو خطأ منطقي جوهري:
// lastDailySent يعني «كل الأيام حتى هذا التاريخ أُرسلت»، لا «هذا اليوم
// الوحيد أُرسل». المقارنة بالتساوي كانت تسمح بمرور كل يوم آخر، وحلقة
// التصريف تختار الأقدم ثم تختم به فيتحرّك الختم **إلى الوراء** — فينشأ
// تناوب لا نهائي بين يومين قديمين يُعيد إرسالهما إلى الأبد.
// الآن: أي يوم ≤ الختم يُعتبر مُرسَلاً، والختم لا يتراجع أبداً.
// ══════════════════════════════════════════════════════════════════════
export const isDayStamped = (settings, dayKey) => {
  const last = settings?.lastDailySent || "";
  if (!last || !dayKey) return false;
  return String(dayKey) <= String(last);
};

// الختم الجديد = الأحدث بين القديم والمطلوب — يستحيل التراجع
export const advanceStamp = (prevStamp, dayKey) => {
  const a = String(prevStamp || ""), b = String(dayKey || "");
  return b > a ? b : a;
};

export const shouldSendOnClose = (store, settings, closedShift, ref = new Date()) => {
  const dayKey = shiftBusinessDay(closedShift);
  if (!dayKey) return null;
  if (isDayStamped(settings, dayKey)) return null;
  if (!dayIsComplete(store.shifts, dayKey, [closedShift], ref)) return null;
  return dayKey;
};

// ══════════════════════════════════════════════════════════════════════
// v48 — أُلغيت شبكة الأمان التلقائية نهائياً.
// ──────────────────────────────────────────────────────────────────────
// كانت مؤقّتاً يعمل على كل جهاز أدمن/كاشير ويقرّر الإرسال نيابةً عن
// المستخدم. ومنها خرجت **كل** أعطال تلغرام الثلاثة:
//   • التكرار بين الأجهزة (لا قفل مشترك)
//   • حلقة إعادة التسليح (تبعية على قيمة يكتبها المؤقّت نفسه)
//   • إعادة إرسال أيام قديمة (الختم يتحرّك للخلف)
// عالجنا الأعراض ثلاث مرات وعادت في كل مرة بشكل جديد. الجذر ليس عطلاً
// بعينه بل وجود قرار تلقائي مؤقَّت أصلاً.
//
// البديل: زرّ يدوي في شاشة الورديات — «أرسل جرد يوم…». الإرسال يصبح
// فعلاً واعياً بقرار الأدمن، فتزول فئة الأعطال كلها بنيوياً لا عرضياً.
// (التقرير التلقائي عند إقفال آخر وردية في اليوم يبقى كما هو — وهو
// المسار الأساسي الصحيح، ومحميّ بالحجز الذرّي في report_log.)
//
// هذه الدالة باقية لخدمة الزرّ اليدوي وأزرار الاختبار: تُجيب على سؤال
// «هل يصلح هذا اليوم للإرسال؟» دون أن ترسل شيئاً بنفسها.
// ══════════════════════════════════════════════════════════════════════
export const canSendDaily = (store, dayKey, ref = new Date()) => {
  if (!dayKey) return { ok: false, reason: "لم يُحدَّد يوم" };
  if (!dayIsOver(dayKey, ref)) return { ok: false, reason: "اليوم ما زال جارياً" };
  const open = openShiftsOfDay(store?.shifts, dayKey, null);
  if (open.length) return { ok: false, reason: `${open.length} وردية من هذا اليوم ما زالت مفتوحة` };
  if (!closedShiftsOfDay(store?.shifts, dayKey, null).length) {
    return { ok: false, reason: "لا توجد ورديات مقفلة في هذا اليوم" };
  }
  return { ok: true };
};

// اسم متوافق مع الاستدعاءات القديمة (يُعيد boolean)
export const shouldSendDaily = (store, settings, dayKey, ref = new Date()) => {
  if (isDayStamped(settings, dayKey)) return false;
  return canSendDaily(store, dayKey, ref).ok;
};
