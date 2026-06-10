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

// ── أونلاين فقط (v22): كتابة مباشرة بمهلة 10 ثوانٍ + رصد البطء (>3 ثوانٍ) ──
const OP_TIMEOUT_MS = 10000;
const SLOW_MS = 3000;
const notifySlow = (op, ms) => {
  try { window.dispatchEvent(new CustomEvent("nc-slow", { detail: { op, ms } })); } catch {}
};
export const withNet = async (label, factory) => {
  const t0 = Date.now();
  const res = await Promise.race([
    factory(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("انتهت المهلة — تحقق من الإنترنت")), OP_TIMEOUT_MS)),
  ]);
  const ms = Date.now() - t0;
  if (ms > SLOW_MS) notifySlow(label, ms);
  return res;
};

export const sbUpsert = async (table, row, conflict = "id", fallbackRow = null) => {
  if (!supabase) return;
  try {
    let { error } = await withNet(`upsert:${table}`, () => supabase.from(table).upsert(row, { onConflict: conflict }));
    if (error && fallbackRow && /(column|schema|does not exist|could not find|cache)/i.test(error.message || "")) {
      const r2 = await withNet(`upsert:${table}`, () => supabase.from(table).upsert(fallbackRow, { onConflict: conflict }));
      error = r2.error || null;
    }
    if (error) { reportSyncError("sbUpsert", table, error.message); return error; }
    return null;
  } catch (err) {
    reportSyncError("sbUpsert", table, String(err?.message || err));
    return err;
  }
};

export const sbDelete = async (table, id) => {
  if (!supabase) return;
  try {
    const { error } = await withNet(`delete:${table}`, () => supabase.from(table).delete().eq("id", id));
    if (error) reportSyncError("sbDelete", table, error.message);
  } catch (err) {
    reportSyncError("sbDelete", table, String(err?.message || err));
  }
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
  // ✅ fix: نستخدم sbUpsert بدل الاستدعاء المباشر → يدخل الطابور الصادر عند الفشل
  return sbUpsert("app_settings",
    { id: "main", data: settings, updated_at: new Date().toISOString() },
    "id"
  );
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
    .subscribe(s => {
      try { window.dispatchEvent(new CustomEvent("nc-rt", { detail: { status: s } })); } catch {}
      if (s === "CHANNEL_ERROR") console.warn("orders realtime error");
    });
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

// ══════════════════════════════════════════════════════════════
// v22: دفع ذرّي — RPC pay_order (انظر db/pay_order.sql) مع fallback تسلسلي
// ══════════════════════════════════════════════════════════════
export const payOrderAtomic = async ({ orderRow, cashRow, freeTable, tableNum, branch }) => {
  if (!supabase) throw new Error("Supabase غير مفعّل");
  // 1) المسار الذرّي عبر RPC إن كانت الدالة منشأة في قاعدة البيانات
  try {
    const { error } = await withNet("rpc:pay_order", () => supabase.rpc("pay_order", {
      p_order: orderRow,
      p_cash: cashRow,
      p_free_table: !!freeTable,
      p_table_num: String(tableNum || ""),
      p_branch: branch || "main",
    }));
    if (!error) return { atomic: true };
    // الدالة غير موجودة بعد → fallback؛ أي خطأ آخر يُرمى للواجهة
    if (!/(function|does not exist|PGRST202|schema cache)/i.test(error.message || "")) {
      throw new Error(error.message);
    }
  } catch (e) {
    const msg = String(e?.message || e);
    if (/انتهت المهلة/.test(msg)) throw e;
    if (!/(function|does not exist|PGRST202|schema cache)/i.test(msg)) throw e;
  }
  // 2) fallback: تحديث الطلب أولاً (الحرِج) ثم النقد ثم الطاولة
  const o = await withNet("pay:order", () => supabase.from("orders").upsert(orderRow, { onConflict: "id" }));
  if (o.error) throw new Error("فشل تحديث الطلب: " + o.error.message);
  const c = await withNet("pay:cash", () => supabase.from("cash_log").upsert(cashRow, { onConflict: "id" }));
  if (c.error) reportSyncError("payOrder", "cash_log", c.error.message);
  if (freeTable && tableNum) {
    const t = await withNet("pay:table", () => supabase.from("tables")
      .update({ status: "free", order_id: null, opened_at: null })
      .eq("num", String(tableNum)).eq("branch", branch || "main"));
    if (t.error) reportSyncError("payOrder", "tables", t.error.message);
  }
  return { atomic: false };
};

// ══════════════════════════════════════════════════════════════
// v22: سجل النشاط (activity_log) — كتابة آمنة الفشل + قراءة + realtime
// (انظر db/activity_log.sql لإنشاء الجدول)
// ══════════════════════════════════════════════════════════════
export const logActivity = (entry) => {
  if (!supabase) return;
  const row = {
    id: "act_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    action: entry.action || "",
    details: entry.details || "",
    user_name: entry.userName || "",
    user_role: entry.userRole || "",
    order_num: String(entry.orderNum || ""),
    amount: entry.amount ?? null,
    branch: entry.branch || "main",
    created_at: new Date().toISOString(),
  };
  try {
    supabase.from("activity_log").insert(row).then(({ error }) => {
      if (error) console.warn("activity_log:", error.message);
    });
  } catch {}
};

export const fetchActivity = async (limit = 200) => {
  if (!supabase) return [];
  try {
    const { data, error } = await withNet("fetch:activity", () =>
      supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(limit));
    if (error) { console.warn("fetchActivity:", error.message); return []; }
    return data || [];
  } catch { return []; }
};

export const subscribeActivity = (onInsert) => {
  if (!supabase) return () => {};
  const ch = supabase.channel("activity-rt-v22")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, p => onInsert && onInsert(p.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
};
