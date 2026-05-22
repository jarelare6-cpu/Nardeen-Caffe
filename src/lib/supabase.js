// src/lib/supabase.js
// ══════════════════════════════════════════════════════════
// Supabase client — single instance for the whole app
// ══════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const url  = import.meta.env.VITE_SUPABASE_URL;
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fallback: إذا لم يُضبط .env بعد، استخدم localStorage فقط
export const SUPABASE_READY = !!(url && key && !url.includes("xxxx"));

export const supabase = SUPABASE_READY
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

// ── Auth helpers ───────────────────────────────────────────
export const sbLogin = async (username, password) => {
  if (!supabase) throw new Error("Supabase غير مفعّل");
  const email = `${username}@nardeen.internal`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error("بيانات الدخول غير صحيحة");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();

  return { ...data.user, ...profile };
};

export const sbLogout = async () => {
  if (supabase) await supabase.auth.signOut();
};

// ── Real-time orders subscription ─────────────────────────
export const subscribeOrders = (onInsert, onUpdate, onDelete) => {
  if (!supabase) return () => {};
  const channel = supabase
    .channel("orders-realtime")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, p => onInsert(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders" }, p => onUpdate(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "orders" }, p => onDelete(p.old))
    .subscribe();
  return () => supabase.removeChannel(channel);
};
