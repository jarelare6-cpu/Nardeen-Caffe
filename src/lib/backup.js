// src/lib/backup.js — v45
// ══════════════════════════════════════════════════════════════════════
// نسخة احتياطية أسبوعية تلقائية إلى تليجرام.
//
// لماذا هذه قبل كل ميزات الحماية؟ لأن **احتمال أن تفقد بياناتك أعلى من
// احتمال أن يسرقك أحد**: ضغطة خاطئة على أحد أزرار التصفير الثلاثة عشر،
// أو خطأ في مشروع Supabase، أو حذف غير مقصود. السرقة تأخذ منك جزءاً؛
// فقدان البيانات يأخذ التاريخ كله ولا يُسترد.
//
// التصميم: JSON خام (لا Excel) لأن الهدف **الاسترجاع** لا القراءة —
// JSON يعيد البيانات كما هي بالضبط، وExcel يفقد الأنواع والتداخل.
// ══════════════════════════════════════════════════════════════════════

import { sendTelegramDocument } from "./telegram.js";

const KEY = "nc_backup_at";
const WEEK_MS = 7 * 86400000;

// الجداول التي تستحقّ الحفظ. النقطة الفاصلة: ما لا يمكن إعادة بنائه.
// (لا نحفظ notifications ولا stockMoves — الأولى عابرة والثانية ضخمة.)
export const buildBackup = (store) => ({
  _meta: {
    app: "nardeen-caffe",
    version: 45,
    takenAt: new Date().toISOString(),
    counts: {
      orders: store.orders?.length || 0,
      menu: store.menu?.length || 0,
      shifts: store.shifts?.length || 0,
    },
  },
  menu:      store.menu      || [],
  orders:    store.orders    || [],
  shifts:    store.shifts    || [],
  debts:     store.debts     || [],
  expenses:  store.expenses  || [],
  customers: store.customers || [],
  cashLog:   store.cashLog   || [],
  compLog:   store.compLog   || [],
  supplies:  store.supplies  || [],
  users:     (store.users || []).map(({ password, ...u }) => u), // كلمات المرور لا تُصدَّر أبداً
  settings:  store.settings  || {},
});

export const backupBlob = (store) => {
  const json = JSON.stringify(buildBackup(store), null, 1);
  return { blob: new Blob([json], { type: "application/json" }), bytes: json.length };
};

export const backupFilename = () =>
  `nardeen-backup-${new Date().toISOString().slice(0, 10)}.json`;

// إرسال يدوي — يُستدعى من زر في الإعدادات، ويعيد نتيجة ليراها الأدمن.
export const sendBackupNow = async (store, targets) => {
  const { blob, bytes } = backupBlob(store);
  const c = buildBackup(store)._meta.counts;
  const caption = `🗄 نسخة احتياطية — ناردين كافيه
📅 ${new Date().toLocaleString("ar-SY")}
🧾 ${c.orders} طلب • 🍽 ${c.menu} صنف • 🕐 ${c.shifts} وردية
💾 ${(bytes / 1024).toFixed(0)} ك.ب`;
  const sent = await sendTelegramDocument(targets, "backup", blob, backupFilename(), caption);
  if (sent > 0) { try { localStorage.setItem(KEY, new Date().toISOString()); } catch {} }
  return { sent, bytes };
};

export const lastBackupAt = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export const backupDue = () => {
  const last = lastBackupAt();
  if (!last) return true;
  const t = new Date(last).getTime();
  return isNaN(t) || Date.now() - t > WEEK_MS;
};

// المسار التلقائي. شرطان يمنعان الإزعاج والتكرار:
//  • الأدمن فقط (لا يرسل كل جهاز نسخته)
//  • مرة كل أسبوع، والختم محلي على جهاز الأدمن
export const maybeWeeklyBackup = async (store, user) => {
  try {
    if (!user || user.role !== "admin") return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
    if (!backupDue()) return false;
    const targets = store.settings?.telegramTargets || [];
    if (!targets.some(t => t?.events?.backup)) return false; // لا وجهة مفعّلة
    if (!(store.orders || []).length) return false;          // لا تُرسل نسخة فارغة
    const { sent } = await sendBackupNow(store, targets);
    return sent > 0;
  } catch { return false; }
};

// ══════════════════════════════════════════════════════════════════════
// v46 — مسار الاسترجاع
// ──────────────────────────────────────────────────────────────────────
// نسخة احتياطية بلا مسار استرجاع ليست نسخة احتياطية — هي شعور بالأمان.
// كانت الملفات تصل إلى تليجرام ولا يوجد زرّ يعيدها، فتُستعاد يدوياً في
// لحظة ذعر. هنا: قراءة، ثم **معاينة** (كم صنفاً، أي تاريخ)، ثم كتابة
// بعد تأكيد صريح. المعاينة قبل الكتابة هي الفرق بين أداة وفخّ.
// ══════════════════════════════════════════════════════════════════════

// الجداول القابلة للاستعادة → اسم الدالة في store
const RESTORE_MAP = [
  ["menu",      "setMenu",      "الأصناف"],
  ["orders",    "setOrders",    "الطلبات"],
  ["debts",     "setDebts",     "الديون"],
  ["expenses",  "setExpenses",  "المصاريف"],
  ["customers", "setCustomers", "الزبائن"],
  ["compLog",   "setCompLog",   "سجل الضيافة"],
  ["settings",  "setSettings",  "الإعدادات"],
];

// يقرأ الملف ويتحقّق من شكله. لا يكتب شيئاً.
export const readBackupFile = async (file) => {
  if (!file) throw new Error("لم يُختَر ملف");
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { throw new Error("الملف ليس JSON صالحاً — تأكد أنه ملف نسخة احتياطية"); }

  if (!data || typeof data !== "object") throw new Error("محتوى الملف غير صالح");
  const looksOurs = data._meta?.app === "nardeen-caffe" || Array.isArray(data.menu) || Array.isArray(data.orders);
  if (!looksOurs) throw new Error("هذا ليس ملف نسخة احتياطية لناردين كافيه");

  // معاينة: ماذا سيُكتب بالضبط، وكم صفاً في كل جدول
  const preview = RESTORE_MAP
    .map(([key, , label]) => {
      const v = data[key];
      if (key === "settings") return v && typeof v === "object" ? { key, label, count: Object.keys(v).length, unit: "حقل" } : null;
      return Array.isArray(v) ? { key, label, count: v.length, unit: "صف" } : null;
    })
    .filter(Boolean);

  return {
    data,
    takenAt: data._meta?.takenAt || null,
    version: data._meta?.version ?? null,
    preview,
  };
};

// يكتب فعلياً. يُستدعى بعد تأكيد المستخدم على المعاينة.
// selected: مصفوفة مفاتيح مختارة (مثل ["menu","orders"]) — أو null لكل شيء.
export const applyBackup = (store, data, selected = null) => {
  const done = [];
  RESTORE_MAP.forEach(([key, setter, label]) => {
    if (selected && !selected.includes(key)) return;
    const v = data[key];
    if (key === "settings") {
      if (v && typeof v === "object") { store.setSettings(p => ({ ...p, ...v })); done.push(label); }
      return;
    }
    if (Array.isArray(v)) { store[setter]?.(v); done.push(`${label} (${v.length})`); }
  });
  // المستخدمون لا يُستعادون: النسخة لا تحوي كلمات المرور، فاستعادتها
  // تعني قفل الجميع خارج النظام. تُدار من تبويب الموظفين.
  return done;
};
