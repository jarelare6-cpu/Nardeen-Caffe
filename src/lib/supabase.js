// src/lib/supabase.js — Nardeen Caffe v4.0
// ══════════════════════════════════════════════════════════════
// اقرأ: أنشئ ملف .env في جذر المشروع بهذه القيم:
//   VITE_SUPABASE_URL=https://xxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
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
      auth: {
        persistSession: false,   // نستخدم sessionStorage يدوياً
        autoRefreshToken: false,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
        heartbeatIntervalMs: 30_000,
      },
      global: {
        fetch: (...args) => fetch(...args),
      },
    })
  : null;

// ── Auth helpers ───────────────────────────────────────────────
export const sbLogin = async (username, password) => {
  if (!supabase) throw new Error("Supabase غير مفعّل — وضع محلي");
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .eq("password", password)
    .eq("active", true)
    .single();
  if (error || !data) throw new Error("بيانات الدخول غير صحيحة");
  return data;
};

// ── Helper: safe upsert ────────────────────────────────────────
export const sbUpsert = async (table, row, conflict = "id") => {
  if (!supabase) return;
  const { error } = await supabase.from(table).upsert(row, { onConflict: conflict });
  if (error) console.warn(`sbUpsert(${table}):`, error.message);
};

export const sbDelete = async (table, id) => {
  if (!supabase) return;
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) console.warn(`sbDelete(${table}):`, error.message);
};

// ── Real-time: الطلبات ─────────────────────────────────────────
export const subscribeOrders = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const ch = supabase
    .channel("orders-rt-v4")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "orders" }, p => onDelete(p.old))
    .subscribe(status => {
      if (status === "CHANNEL_ERROR") console.warn("orders realtime error");
    });
  return () => supabase.removeChannel(ch);
};

// ── Real-time: الطاولات ────────────────────────────────────────
export const subscribeTables = (onChange) => {
  if (!supabase) return () => {};
  const ch = supabase
    .channel("tables-rt-v4")
    .on("postgres_changes", { event: "*", schema: "public", table: "tables" }, p => {
      if (p.eventType === "DELETE") onChange(null, p.old.id);
      else onChange(p.new, null);
    })
    .subscribe();
  return () => supabase.removeChannel(ch);
};

// ── Real-time: الديون ──────────────────────────────────────────
export const subscribeDebts = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const ch = supabase
    .channel("debts-rt-v4")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "debts" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "debts" }, p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "debts" }, p => onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

// ── Real-time: المصاريف ────────────────────────────────────────
export const subscribeExpenses = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const ch = supabase
    .channel("expenses-rt-v4")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "expenses" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "expenses" }, p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "expenses" }, p => onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

// ── Real-time: المنيو ──────────────────────────────────────────
export const subscribeMenu = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const ch = supabase
    .channel("menu-rt-v4")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "menu_items" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "menu_items" }, p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "menu_items" }, p => onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

// ── Real-time: الفواتير ────────────────────────────────────────
export const subscribeReceipts = (onInsert) => {
  if (!supabase) return () => {};
  const ch = supabase
    .channel("receipts-rt-v4")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "receipts" }, p => onInsert(p.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

// ── Real-time: سجل الضيافة ─────────────────────────────────────
export const subscribeCompLog = (onInsert) => {
  if (!supabase) return () => {};
  const ch = supabase
    .channel("complog-rt-v4")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "comp_log" }, p => onInsert(p.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
};

// ── Real-time: الزبائن ─────────────────────────────────────────
export const subscribeCustomers = (onInsert, onUpdate) => {
  if (!supabase) return () => {};
  const ch = supabase
    .channel("customers-rt-v4")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "customers" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customers" }, p => onUpdate(p.new))
    .subscribe();
  return () => supabase.removeChannel(ch);
};
