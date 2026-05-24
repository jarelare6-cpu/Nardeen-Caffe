// src/lib/supabase.js
// ══════════════════════════════════════════════════════════
// Supabase client — single instance for the whole app
// ══════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fallback: إذا لم يُضبط .env، استخدم localStorage فقط
export const SUPABASE_READY = !!(
  url && key &&
  !url.includes("xxxx") &&
  url.startsWith("https://") &&
  key.startsWith("eyJ")
);

export const supabase = SUPABASE_READY
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: {
        params: { eventsPerSecond: 10 },
        heartbeatIntervalMs: 30000,  // يمنع انقطاع الاتصال
      },
    })
  : null;

// ── Auth helpers ───────────────────────────────────────────
// تسجيل الدخول بدون Supabase Auth — مباشرة من جدول profiles
export const sbLogin = async (username, password) => {
  if (!supabase) throw new Error("Supabase غير مفعّل");
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

export const sbLogout = async () => {
  // لا session حقيقي — يكفي مسح localStorage من الـ App
};

// ── Real-time: الطلبات ─────────────────────────────────────
export const subscribeOrders = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const channel = supabase
    .channel("orders-realtime")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" },
      p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" },
      p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "orders" },
      p => onDelete(p.old))
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        console.warn("orders realtime error — retrying...");
      }
    });
  return () => supabase.removeChannel(channel);
};

// ── Real-time: الطاولات ────────────────────────────────────
export const subscribeTables = (onChange) => {
  if (!supabase) return () => {};
  const channel = supabase
    .channel("tables-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "tables" },
      p => {
        if (p.eventType === "DELETE") onChange(null, p.old.id);
        else onChange(p.new, null);
      })
    .subscribe();
  return () => supabase.removeChannel(channel);
};

// ── Real-time: الديون ──────────────────────────────────────
export const subscribeDebts = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const channel = supabase
    .channel("debts-realtime")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "debts" },
      p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "debts" },
      p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "debts" },
      p => onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(channel);
};

// ── Real-time: المصاريف ────────────────────────────────────
export const subscribeExpenses = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const channel = supabase
    .channel("expenses-realtime")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "expenses" },
      p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "expenses" },
      p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "expenses" },
      p => onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(channel);
};

// ── Real-time: المنيو ──────────────────────────────────────
export const subscribeMenu = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const channel = supabase
    .channel("menu-realtime")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "menu_items" },
      p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "menu_items" },
      p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "menu_items" },
      p => onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(channel);
};
