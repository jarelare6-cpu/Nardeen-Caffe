// src/lib/supabase.js — Nardeen Caffe v6.0
// ══════════════════════════════════════════════════════════════
// تحسينات v6:
//  - تشفير كلمات المرور (SHA-256)
//  - subscribeReceipts مفعّل
//  - cash_log يُرفع لـ Supabase
// ══════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_READY = !!(
  url && key &&
  !url.includes("xxxx") &&
  url.startsWith("https://") &&
  (key.startsWith("eyJ") || key.startsWith("sb_"))
);

if (!SUPABASE_READY) {
  console.warn(
    "⚠️ Supabase غير مفعّل.\n" +
    "أنشئ ملف .env في جذر المشروع:\n" +
    "VITE_SUPABASE_URL=https://xxxx.supabase.co\n" +
    "VITE_SUPABASE_ANON_KEY=eyJ..."
  );
}

export const supabase = SUPABASE_READY
  ? createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 }, heartbeatIntervalMs: 30_000 },
      global: { fetch: (...args) => fetch(...args) },
    })
  : null;

// ══════════════════════════════════════════════════════════════
// تشفير كلمات المرور — SHA-256 (نُقل إلى utils.js ليكون في الحزمة الرئيسية).
import { hashPassword, verifyPassword } from "./utils.js";
export { hashPassword, verifyPassword };

// ── Auth helper مع دعم التشفير ─────────────────────────────
export const sbLogin = async (username, password) => {
  if (!supabase) throw new Error("Supabase غير مفعّل — وضع محلي");
  // جلب المستخدم بالاسم فقط أولاً
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .eq("active", true)
    .single();
  if (error || !data) throw new Error("بيانات الدخول غير صحيحة");
  const ok = await verifyPassword(password, data.password);
  if (!ok) throw new Error("بيانات الدخول غير صحيحة");
  return data;
};

// ── Helpers ──────────────────────────────────────────────────
// تقرير أخطاء المزامنة: يُظهرها بدل ابتلاعها بصمت (مشكلة عدم ظهور الطلب)
export const reportSyncError = (op, table, message) => {
  console.warn(`${op}(${table}):`, message);
  try {
    window.dispatchEvent(new CustomEvent("nc-sync-error", { detail: { op, table, message } }));
  } catch {}
};

// ── الطابور الصادر (Outbox): يخزّن الكتابات الفاشلة ويعيد رفعها تلقائيًا.
//    مع سقف محاولات + عزل العناصر الفاشلة دائمًا (dead-letter) + وقت آخر مزامنة. ──
const OUTBOX_KEY = "nc_outbox";
const FAILED_KEY = "nc_outbox_failed";
const LASTSYNC_KEY = "nc_last_sync";
const MAX_TRIES = 5;
let _flushing = false;

const readQ = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const writeQ = (k, q) => { try { localStorage.setItem(k, JSON.stringify(q)); } catch {} };
const outboxKey = (e) => `${e.table}:${e.del || e.row?.id}`;
const notifyOutbox = () => {
  try {
    window.dispatchEvent(new CustomEvent("nc-outbox", { detail: {
      count: readQ(OUTBOX_KEY).length, failed: readQ(FAILED_KEY).length, inProgress: _flushing,
    }}));
  } catch {}
};
const enqueue = (entry) => {
  const q = readQ(OUTBOX_KEY).filter(e => outboxKey(e) !== outboxKey(entry));
  q.push({ ...entry, tries: 0, ts: Date.now() });
  writeQ(OUTBOX_KEY, q); notifyOutbox();
};

export const outboxCount = () => readQ(OUTBOX_KEY).length;
export const outboxFailedCount = () => readQ(FAILED_KEY).length;
export const outboxList = () => readQ(OUTBOX_KEY);
export const outboxFailed = () => readQ(FAILED_KEY);
export const outboxInProgress = () => _flushing;
export const lastSyncAt = () => { try { return localStorage.getItem(LASTSYNC_KEY); } catch { return null; } };
export const retryFailed = () => {
  const failed = readQ(FAILED_KEY); if (!failed.length) return;
  const q = readQ(OUTBOX_KEY);
  failed.forEach(e => q.push({ ...e, tries: 0 }));
  writeQ(OUTBOX_KEY, q); writeQ(FAILED_KEY, []); notifyOutbox(); flushOutbox();
};

export const flushOutbox = async () => {
  if (!supabase || _flushing) return;
  const q = readQ(OUTBOX_KEY);
  if (!q.length) return;
  _flushing = true; notifyOutbox();
  const remaining = []; const dead = readQ(FAILED_KEY); let anyOk = false;
  for (const e of q) {
    try {
      const { error } = e.del
        ? await supabase.from(e.table).delete().eq("id", e.del)
        : await supabase.from(e.table).upsert(e.row, { onConflict: "id" });
      if (error) {
        const tries = (e.tries || 0) + 1;
        (tries >= MAX_TRIES ? dead : remaining).push({ ...e, tries, lastError: error.message });
      } else anyOk = true;
    } catch (err) {
      const tries = (e.tries || 0) + 1;
      (tries >= MAX_TRIES ? dead : remaining).push({ ...e, tries, lastError: String((err && err.message) || err) });
    }
  }
  writeQ(OUTBOX_KEY, remaining); writeQ(FAILED_KEY, dead);
  if (anyOk) { try { localStorage.setItem(LASTSYNC_KEY, new Date().toISOString()); } catch {} }
  _flushing = false; notifyOutbox();
};

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { flushOutbox(); });
  setInterval(() => { if (navigator.onLine) flushOutbox(); }, 30000);
}

export const sbUpsert = async (table, row, conflict = "id") => {
  if (!supabase) return;
  const { error } = await supabase.from(table).upsert(row, { onConflict: conflict });
  if (error) { reportSyncError("sbUpsert", table, error.message); enqueue({ table, row }); }
  return error || null;
};

export const sbDelete = async (table, id) => {
  if (!supabase) return;
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) { reportSyncError("sbDelete", table, error.message); enqueue({ table, del: id }); }
};

export const sbDeleteAll = async (table) => {
  if (!supabase) return;
  const { error } = await supabase.from(table).delete().neq("id", "__never__");
  if (error) console.warn(`sbDeleteAll(${table}):`, error.message);
};

// ── نبض الجهاز (heartbeat) للمراقبة عن بُعد ──
// كتابة آمنة الفشل: لا تدخل الطابور الصادر ولا ترمي خطأ (إن لم توجد الجدول
// تُتجاهَل بصمت). تتطلب جدول device_status (انظر db/heartbeat.sql).
export const sbHeartbeat = async (row) => {
  if (!supabase) return;
  try { await supabase.from("device_status").upsert({ ...row, last_seen: new Date().toISOString() }, { onConflict: "id" }); } catch {}
};

export const sbFetchDevices = async () => {
  if (!supabase) return [];
  try { const { data } = await supabase.from("device_status").select("*"); return data || []; } catch { return []; }
};

export const sbSaveSettings = async (settings) => {
  if (!supabase) return;
  const { error } = await supabase.from("app_settings").upsert(
    { id: "main", data: settings, updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
  if (error) console.warn("sbSaveSettings:", error.message);
};

export const sbSavePermOverrides = async (perms) => {
  if (!supabase) return;
  const { error } = await supabase.from("perm_overrides").upsert(
    { id: "main", data: perms, updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
  if (error) console.warn("sbSavePermOverrides:", error.message);
};

export const sbFetch = async (table, orderCol = "created_at") => {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .order(orderCol, { ascending: false });
  if (error) { console.warn(`sbFetch(${table}):`, error.message); return []; }
  return data || [];
};

// ══════════════════════════════════════════════════════════════
// Real-time subscriptions
// ══════════════════════════════════════════════════════════════
export const subscribeOrders = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("orders-rt-v6")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "orders" }, p => onDelete(p.old))
    .subscribe(s => { if (s === "CHANNEL_ERROR") console.warn("orders realtime error"); });
  return () => supabase.removeChannel(ch);
};

export const subscribeTables = (onChange) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("tables-rt-v6")
    .on("postgres_changes", { event: "*", schema: "public", table: "tables" }, p => {
      if (p.eventType === "DELETE") onChange(null, p.old.id);
      else onChange(p.new, null);
    }).subscribe();
  return () => supabase.removeChannel(ch);
};

export const subscribeDebts = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("debts-rt-v6")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "debts" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "debts" }, p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "debts" }, p => onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

export const subscribeExpenses = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("expenses-rt-v6")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "expenses" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "expenses" }, p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "expenses" }, p => onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

export const subscribeMenu = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("menu-rt-v6")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "menu_items" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "menu_items" }, p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "menu_items" }, p => onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

// ✅ الفواتير الآن مربوطة بـ realtime
export const subscribeReceipts = (onInsert, onUpdate) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("receipts-rt-v6")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "receipts" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "receipts" }, p => onUpdate && onUpdate(p.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

export const subscribeCompLog = (onInsert) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("complog-rt-v6")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "comp_log" }, p => onInsert(p.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

export const subscribeCustomers = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("customers-rt-v6")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "customers" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customers" }, p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "customers" }, p => onDelete && onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

export const subscribeSettings = (onUpsert) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("settings-rt-v6")
    .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, p => {
      if (p.new) onUpsert(p.new);
    }).subscribe();
  return () => supabase.removeChannel(ch);
};

export const subscribePermOverrides = (onUpsert) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("perms-rt-v6")
    .on("postgres_changes", { event: "*", schema: "public", table: "perm_overrides" }, p => {
      if (p.new) onUpsert(p.new);
    }).subscribe();
  return () => supabase.removeChannel(ch);
};

// ══════════════════════════════════════════════════════════════
// v7: Real-time للورديات (shifts)
// ══════════════════════════════════════════════════════════════
export const subscribeShifts = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("shifts-rt-v7")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "shifts" }, p => onInsert && onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shifts" }, p => onUpdate && onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "shifts" }, p => onDelete && onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

// ══════════════════════════════════════════════════════════════
// v7: Real-time لسجل الولاء (loyalty_log)
// ══════════════════════════════════════════════════════════════
export const subscribeLoyaltyLog = (onInsert) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("loyalty-rt-v7")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "loyalty_log" }, p => onInsert && onInsert(p.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

// ══════════════════════════════════════════════════════════════
// v7: Real-time لسجل النقد (cash_log)
// ══════════════════════════════════════════════════════════════
export const subscribeCashLog = (onInsert, onDelete) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("cashlog-rt-v7")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "cash_log" }, p => onInsert && onInsert(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "cash_log" }, p => onDelete && onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(ch);
};
