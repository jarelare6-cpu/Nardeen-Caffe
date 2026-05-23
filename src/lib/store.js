// src/lib/store.js — Nardeen Caffe v5 — FULLY SYNCED
import { useState, useCallback, useEffect } from "react";
import { supabase, SUPABASE_READY } from "./supabase";

const ls = {
  get: (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
  set: (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("nardeen_sync") : null;
const broadcast = (key, data) => { if (bc) bc.postMessage({ key, data, ts: Date.now() }); };

const sbWrite = {
  order: async (order) => { if (SUPABASE_READY) await supabase.from("orders").upsert(order, { onConflict: "id" }); },
  cashLog: async (entry) => { if (SUPABASE_READY) await supabase.from("cash_log").upsert(entry, { onConflict: "id" }); },
};

export const DEFAULT_SETTINGS = { cafeName: "Nardeen Caffe", signature: "بإدارة يحيى داؤود", currency: "ل.س", maxDiscount: 50, workerCanDecreaseStock: false, cashierCanSeeReports: true, allowCustomerOrders: false, taxPercent: 0, appLang: "ar" };

export const DEFAULT_USERS = [
  { id:"u1", username:"admin",      password:"admin1",    role:"admin",   name:"يحيى داؤود",    email:"admin@nardeen.cafe",      active:true, shift:null },
  { id:"u2", username:"cashier_am", password:"Cash@AM24", role:"cashier", name:"كاشير الصباح",  email:"cashier.am@nardeen.cafe", active:true, shift:"صباحي" },
  { id:"u3", username:"cashier_pm", password:"Cash@PM24", role:"cashier", name:"كاشير المساء",  email:"cashier.pm@nardeen.cafe", active:true, shift:"مسائي" }
];

export const DEFAULT_MENU = [
  { id:"m1", name:"قهوة عربية", price:2500, category:"hot_drinks", stock:100, emoji:"☕️" },
  { id:"m2", name:"شاي", price:1500, category:"hot_drinks", stock:80, emoji:"🍵" },
  { id:"m5", name:"موهيتو", price:6000, category:"cold_drinks", stock:40, emoji:"🍹" }
  // ... يمكنك إضافة باقي العناصر هنا بنفس الطريقة
];

export const useStore = () => {
  const [menu, setMenuRaw] = useState(() => ls.get("nc_menu", DEFAULT_MENU));
  const [orders, setOrdersRaw] = useState(() => ls.get("nc_orders", []));
  const [cashLog, setCashLogRaw] = useState(() => ls.get("nc_cash", []));

  const setMenu = useCallback((v) => {
    setMenuRaw(p => { const d = typeof v === "function" ? v(p) : v; ls.set("nc_menu", d); broadcast("nc_menu", d); return d; });
  }, []);

  // ── Realtime Listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!SUPABASE_READY) return;

    const channel = supabase
      .channel("realtime-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
        setOrdersRaw(prev => { 
            const n = p.eventType === 'DELETE' ? prev.filter(o => o.id !== p.old.id) : [p.new, ...prev.filter(o => o.id !== p.new.id)];
            ls.set("nc_orders", n); broadcast("nc_orders", n); return n;
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_log" }, (p) => {
        setCashLogRaw(prev => { const n = [p.new, ...prev.filter(i => i.id !== p.new.id)]; ls.set("nc_cash", n); return n; });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, (p) => {
        setMenuRaw(prev => { const n = prev.map(i => i.id === p.new.id ? p.new : i); ls.set("nc_menu", n); return n; });
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  return { menu, setMenu, orders, cashLog };
};
