// src/lib/store.js — Nardeen Caffe v4.0
// ══════════════════════════════════════════════════════════════
// إصلاح الربط + 20 طاولة افتراضية + إعادة المخزون عند الحذف
// ══════════════════════════════════════════════════════════════
import { useState, useCallback, useEffect } from "react";
import {
  supabase, SUPABASE_READY,
  sbUpsert, sbDelete,
  subscribeOrders, subscribeTables,
  subscribeDebts, subscribeExpenses, subscribeMenu,
} from "./supabase";

// ── localStorage helpers ──────────────────────────────────────
const ls = {
  get: (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
  set: (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ── BroadcastChannel — مزامنة بين تبويبات نفس الجهاز ─────────
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("nardeen_v4") : null;
const broadcast = (key, data) => { if (bc) bc.postMessage({ key, data, ts: Date.now() }); };

// ══════════════════════════════════════════════════════════════
// الطاولات الافتراضية — 20 طاولة
// ══════════════════════════════════════════════════════════════
export const buildDefaultTables = (count = 20) =>
  Array.from({ length: count }, (_, i) => ({
    id:       `tbl_${i + 1}`,
    number:   i + 1,
    num:      String(i + 1),
    label:    `طاولة ${i + 1}`,
    seats:    4,
    status:   "free",
    note:     "",
    orderId:  null,
    openedAt: null,
  }));

// ══════════════════════════════════════════════════════════════
// الإعدادات الافتراضية
// ══════════════════════════════════════════════════════════════
export const DEFAULT_SETTINGS = {
  cafeName:               "Nardeen Caffe",
  signature:              "بإدارة يحيى داؤود",
  currency:               "ل.س",
  maxDiscount:            50,
  workerCanDecreaseStock: false,
  cashierCanSeeReports:   true,
  allowCustomerOrders:    true,
  taxPercent:             0,
  appLang:                "ar",
  cashierCode:            "narden",
  appTheme:               "default",
  defaultTableCount:      20,
};

export const DEFAULT_USERS = [
  { id:"u1", username:"admin",      password:"admin1",    role:"admin",   name:"يحيى داؤود",    email:"admin@nardeen.cafe",      active:true, shift:null },
  { id:"u2", username:"cashier_am", password:"Cash@AM24", role:"cashier", name:"كاشير الصباح",  email:"cashier.am@nardeen.cafe", active:true, shift:"صباحي" },
  { id:"u3", username:"cashier_pm", password:"Cash@PM24", role:"cashier", name:"كاشير المساء",  email:"cashier.pm@nardeen.cafe", active:true, shift:"مسائي" },
  { id:"u4", username:"bar1",       password:"Bar@AM24",  role:"bar",     name:"بار الصباح",    email:"bar1@nardeen.cafe",       active:true, shift:"صباحي" },
  { id:"u5", username:"bar2",       password:"Bar@PM24",  role:"bar",     name:"بار المساء",    email:"bar2@nardeen.cafe",       active:true, shift:"مسائي" },
  { id:"u6", username:"hookah1",    password:"Hook@AM24", role:"hookah",  name:"أراكيل الصباح", email:"hookah1@nardeen.cafe",    active:true, shift:"صباحي" },
  { id:"u7", username:"hookah2",    password:"Hook@PM24", role:"hookah",  name:"أراكيل المساء", email:"hookah2@nardeen.cafe",    active:true, shift:"مسائي" },
  { id:"u8", username:"worker1",    password:"Work@AM24", role:"worker",  name:"عامل الصباح",   email:"worker1@nardeen.cafe",    active:true, shift:"صباحي" },
  { id:"u9", username:"worker2",    password:"Work@PM24", role:"worker",  name:"عامل المساء",   email:"worker2@nardeen.cafe",    active:true, shift:"مسائي" },
];

export const DEFAULT_MENU = [
  { id:"m1",  name:"قهوة عربية",     nameEn:"Arabic Coffee",    price:2500,  category:"hot_drinks",  stock:100, minStock:10, totalSold:0, emoji:"☕", active:true },
  { id:"m2",  name:"شاي",            nameEn:"Tea",              price:1500,  category:"hot_drinks",  stock:80,  minStock:10, totalSold:0, emoji:"🍵", active:true },
  { id:"m3",  name:"كابتشينو",       nameEn:"Cappuccino",       price:5000,  category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"☕", active:true },
  { id:"m4",  name:"لاتيه",          nameEn:"Latte",            price:5500,  category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"☕", active:true },
  { id:"m15", name:"أمريكانو",       nameEn:"Americano",        price:4000,  category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"☕", active:true },
  { id:"m16", name:"شوكولاتة ساخنة", nameEn:"Hot Chocolate",    price:5000,  category:"hot_drinks",  stock:40,  minStock:5,  totalSold:0, emoji:"🫗", active:true },
  { id:"m5",  name:"موهيتو",         nameEn:"Mojito",           price:6000,  category:"cold_drinks", stock:40,  minStock:5,  totalSold:0, emoji:"🍹", active:true },
  { id:"m6",  name:"عصير ليمون",     nameEn:"Lemon Juice",      price:4000,  category:"cold_drinks", stock:50,  minStock:5,  totalSold:0, emoji:"🍋", active:true },
  { id:"m7",  name:"ماء معدني",      nameEn:"Water",            price:1000,  category:"cold_drinks", stock:200, minStock:20, totalSold:0, emoji:"💧", active:true },
  { id:"m17", name:"سموذي مانجو",    nameEn:"Mango Smoothie",   price:7000,  category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🥭", active:true },
  { id:"m18", name:"عصير برتقال",    nameEn:"Orange Juice",     price:5000,  category:"cold_drinks", stock:40,  minStock:5,  totalSold:0, emoji:"🍊", active:true },
  { id:"m8",  name:"ساندويتش دجاج",  nameEn:"Chicken Sandwich", price:8000,  category:"food",        stock:30,  minStock:5,  totalSold:0, emoji:"🥪", active:true },
  { id:"m9",  name:"بيتزا صغيرة",   nameEn:"Small Pizza",      price:15000, category:"food",        stock:20,  minStock:3,  totalSold:0, emoji:"🍕", active:true },
  { id:"m10", name:"كيكة شوكولاتة", nameEn:"Chocolate Cake",   price:7000,  category:"food",        stock:15,  minStock:3,  totalSold:0, emoji:"🍰", active:true },
  { id:"m19", name:"ساندويتش فلافل", nameEn:"Falafel Sandwich", price:5000,  category:"food",        stock:25,  minStock:5,  totalSold:0, emoji:"🥙", active:true },
  { id:"m11", name:"معسل تفاح",      nameEn:"Apple Hookah",     price:12000, category:"hookah",      stock:50,  minStock:5,  totalSold:0, emoji:"💨", active:true },
  { id:"m12", name:"معسل عنب",       nameEn:"Grape Hookah",     price:12000, category:"hookah",      stock:50,  minStock:5,  totalSold:0, emoji:"💨", active:true },
  { id:"m13", name:"معسل نعناع",     nameEn:"Mint Hookah",      price:12000, category:"hookah",      stock:50,  minStock:5,  totalSold:0, emoji:"💨", active:true },
  { id:"m20", name:"معسل توت",       nameEn:"Berry Hookah",     price:13000, category:"hookah",      stock:40,  minStock:5,  totalSold:0, emoji:"💨", active:true },
  { id:"m14", name:"فحم إضافي",      nameEn:"Extra Charcoal",   price:3000,  category:"hookah",      stock:100, minStock:10, totalSold:0, emoji:"🔥", active:true },
];

// ══════════════════════════════════════════════════════════════
// كتابة إلى Supabase
// ══════════════════════════════════════════════════════════════
const sbWrite = {
  user: (u) => sbUpsert("profiles", {
    id: u.id, username: u.username, password: u.password,
    role: u.role, name: u.name, email: u.email || "",
    active: u.active, shift: u.shift || null,
  }),
  deleteUser: (id) => sbDelete("profiles", id),

  menuItem: (m) => sbUpsert("menu_items", {
    id: m.id, name: m.name, name_en: m.nameEn || "",
    price: m.price, category: m.category,
    stock: m.stock, min_stock: m.minStock || 5,
    total_sold: m.totalSold || 0, emoji: m.emoji || "",
    active: m.active !== false,
  }),
  deleteMenuItem: (id) => sbDelete("menu_items", id),

  order: (o) => sbUpsert("orders", {
    id: o.id, order_num: o.orderNum,
    customer_name: o.customerName, customer_id: o.customerId || null,
    table_num: o.table || "", items: o.items,
    total: o.total, discount: o.discount || 0,
    status: o.status, payment_type: o.paymentType || "cash",
    notes: o.notes || "", created_at: o.createdAt,
    paid_at: o.paidAt || null, paid_by: o.paidBy || null,
    paid_by_name: o.paidByName || "",
    is_debt_settlement: o.isDebtSettlement || false,
    original_total: o.originalTotal || null,
    comp_amount: o.compAmount || 0,
    is_complimentary: o.isComplimentary || false,
    worker_name: o.workerName || "",
  }),
  deleteOrder: (id) => sbDelete("orders", id),

  table: (t) => sbUpsert("tables", {
    id: t.id, number: t.number || 0, num: String(t.number || ""),
    label: t.label || `طاولة ${t.number}`,
    seats: t.seats || 4, status: t.status || "free",
    note: t.note || "", order_id: t.orderId || null,
    opened_at: t.openedAt || null,
  }),

  debt: (d) => sbUpsert("debts", {
    id: d.id, customer_name: d.customerName,
    amount: d.amount, remaining: d.remaining,
    settled: d.settled, settled_at: d.settledAt || null,
    date: d.date, notes: d.notes || "",
    created_by: d.createdBy || "", order_id: d.orderId || null,
    order_num: d.orderNum || "",
  }),

  expense: (e) => sbUpsert("expenses", {
    id: e.id, label: e.label || e.description || "",
    description: e.description || e.label || "",
    amount: e.amount, category: e.category || "other",
    date: e.date, by: e.by || e.createdBy || "",
    created_by: e.createdBy || e.by || "",
    notes: e.notes || "", is_secondary: e.isSecondary || false,
    order_id: e.orderId || null, order_num: e.orderNum || "",
    is_complimentary: e.isComplimentary || false,
  }),

  cashLog: (e) => sbUpsert("cash_log", {
    id: e.id, order_id: e.orderId || null,
    order_num: e.orderNum || "", amount: e.amount,
    at: e.at, by: e.by || "", type: e.type || "sale",
  }),

  receipt: (r) => sbUpsert("receipts", {
    id: r.id, order_id: r.orderId || null,
    order_num: r.orderNum || "", customer_name: r.customerName || "",
    table_num: r.tableNum || "", items: r.items || [],
    total: r.total || 0, discount: r.discount || 0,
    payment_type: r.paymentType || "cash", notes: r.notes || "",
    created_by: r.createdBy || "", created_at: r.createdAt || new Date().toISOString(),
    cafe_name: r.cafeName || "Nardeen Caffe",
    tron_amount: r.tronAmount || 0,
  }),
};

// ══════════════════════════════════════════════════════════════
// mappers: Supabase → App format
// ══════════════════════════════════════════════════════════════
const mapOrder = o => ({
  ...o,
  orderNum:     o.order_num     ?? o.orderNum     ?? "",
  customerName: o.customer_name ?? o.customerName ?? "زبون",
  customerId:   o.customer_id   ?? o.customerId   ?? null,
  table:        o.table_num     ?? o.table        ?? "",
  paymentType:  o.payment_type  ?? o.paymentType  ?? "cash",
  createdAt:    o.created_at    ?? o.createdAt    ?? new Date().toISOString(),
  paidAt:       o.paid_at       ?? o.paidAt       ?? null,
  paidBy:       o.paid_by       ?? o.paidBy       ?? null,
  paidByName:   o.paid_by_name  ?? o.paidByName   ?? "",
  isDebtSettlement: o.is_debt_settlement ?? o.isDebtSettlement ?? false,
  originalTotal: o.original_total ?? o.originalTotal ?? null,
  compAmount:   o.comp_amount   ?? o.compAmount   ?? 0,
  isComplimentary: o.is_complimentary ?? o.isComplimentary ?? false,
  workerName:   o.worker_name   ?? o.workerName   ?? "",
});
const mapMenu = m => ({
  ...m,
  nameEn:    m.name_en   ?? m.nameEn    ?? "",
  minStock:  m.min_stock ?? m.minStock  ?? 5,
  totalSold: m.total_sold ?? m.totalSold ?? 0,
});
const mapDebt = d => ({
  ...d,
  customerName: d.customer_name ?? d.customerName ?? "",
  settledAt:    d.settled_at    ?? d.settledAt    ?? null,
  createdBy:    d.created_by    ?? d.createdBy    ?? "",
  orderId:      d.order_id      ?? d.orderId      ?? null,
  orderNum:     d.order_num     ?? d.orderNum     ?? "",
});
const mapExpense = e => ({
  ...e,
  description:  e.description ?? e.label ?? "",
  label:        e.label ?? e.description ?? "",
  createdBy:    e.created_by ?? e.createdBy ?? e.by ?? "",
  by:           e.by ?? e.created_by ?? e.createdBy ?? "",
  isSecondary:  e.is_secondary ?? e.isSecondary ?? false,
  orderId:      e.order_id ?? e.orderId ?? null,
  orderNum:     e.order_num ?? e.orderNum ?? "",
  isComplimentary: e.is_complimentary ?? e.isComplimentary ?? false,
});
const mapTable = t => ({
  id:       t.id,
  number:   t.number || +t.num || 0,
  num:      String(t.num || t.number || ""),
  label:    t.label || `طاولة ${t.num || t.number}`,
  seats:    t.seats || 4,
  status:   t.status || "free",
  note:     t.note || "",
  orderId:  t.order_id || null,
  openedAt: t.opened_at || null,
});
const mapCash = e => ({
  ...e,
  orderId:  e.order_id  ?? e.orderId  ?? null,
  orderNum: e.order_num ?? e.orderNum ?? "",
});
const mapReceipt = r => ({
  ...r,
  orderId:      r.order_id      ?? r.orderId      ?? null,
  orderNum:     r.order_num     ?? r.orderNum      ?? "",
  customerName: r.customer_name ?? r.customerName ?? "",
  tableNum:     r.table_num     ?? r.tableNum     ?? "",
  paymentType:  r.payment_type  ?? r.paymentType  ?? "cash",
  createdBy:    r.created_by    ?? r.createdBy    ?? "",
  createdAt:    r.created_at    ?? r.createdAt    ?? new Date().toISOString(),
  cafeName:     r.cafe_name     ?? r.cafeName     ?? "Nardeen Caffe",
  tronAmount:   r.tron_amount   ?? r.tronAmount   ?? 0,
});

// ══════════════════════════════════════════════════════════════
// MAIN STORE HOOK
// ══════════════════════════════════════════════════════════════
export const useStore = () => {
  const [users,         setUsersRaw]        = useState(() => ls.get("nc_users",    DEFAULT_USERS));
  const [menu,          setMenuRaw]          = useState(() => ls.get("nc_menu",     DEFAULT_MENU));
  const [orders,        setOrdersRaw]        = useState(() => ls.get("nc_orders",   []));
  const [notifications, setNotificationsRaw] = useState(() => ls.get("nc_notifs",   []));
  const [cashLog,       setCashLogRaw]       = useState(() => ls.get("nc_cash",     []));
  const [tables,        setTablesRaw]        = useState(() => {
    const saved = ls.get("nc_tables", null);
    // إذا لم تكن الطاولات محفوظة، أنشئ 20 طاولة افتراضية
    return saved && saved.length > 0 ? saved : buildDefaultTables(20);
  });
  const [debts,         setDebtsRaw]         = useState(() => ls.get("nc_debts",    []));
  const [expenses,      setExpensesRaw]      = useState(() => ls.get("nc_expenses", []));
  const [receipts,      setReceiptsRaw]      = useState(() => ls.get("nc_receipts", []));
  const [settings,      setSettingsRaw]      = useState(() => ls.get("nc_settings", DEFAULT_SETTINGS));
  const [syncing,       setSyncing]          = useState(false);
  const [cloudReady,    setCloudReady]       = useState(false);

  // ── Setters مع sync إلى Supabase ──────────────────────────

  const setUsers = useCallback((v) => {
    setUsersRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_users", next); broadcast("nc_users", next);
      if (SUPABASE_READY) {
        next.forEach(u => {
          const old = p.find(x => x.id === u.id);
          if (!old || JSON.stringify(old) !== JSON.stringify(u)) sbWrite.user(u);
        });
        p.forEach(u => { if (!next.find(x => x.id === u.id)) sbWrite.deleteUser(u.id); });
      }
      return next;
    });
  }, []);

  const setMenu = useCallback((v) => {
    setMenuRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_menu", next); broadcast("nc_menu", next);
      if (SUPABASE_READY) {
        next.forEach(m => {
          const old = p.find(x => x.id === m.id);
          if (!old || JSON.stringify(old) !== JSON.stringify(m)) sbWrite.menuItem(m);
        });
        p.forEach(m => { if (!next.find(x => x.id === m.id)) sbWrite.deleteMenuItem(m.id); });
      }
      return next;
    });
  }, []);

  const setOrders = useCallback((v) => {
    setOrdersRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_orders", next); broadcast("nc_orders", next);
      if (SUPABASE_READY) {
        const changed = next.filter(o => {
          const old = p.find(x => x.id === o.id);
          return !old || old.status !== o.status || old.total !== o.total ||
                 old.paymentType !== o.paymentType || old.discount !== o.discount;
        });
        changed.forEach(o => sbWrite.order(o));
        const nextIds = new Set(next.map(o => o.id));
        p.filter(o => !nextIds.has(o.id)).forEach(o => sbWrite.deleteOrder(o.id));
      }
      return next;
    });
  }, []);

  const setNotifications = useCallback((v) => {
    setNotificationsRaw(p => {
      const d = typeof v === "function" ? v(p) : v;
      ls.set("nc_notifs", d); broadcast("nc_notifs", d); return d;
    });
  }, []);

  const setCashLog = useCallback((v) => {
    setCashLogRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_cash", next); broadcast("nc_cash", next);
      if (SUPABASE_READY) {
        const prevIds = new Set(p.map(e => e.id));
        next.filter(e => !prevIds.has(e.id)).forEach(e => sbWrite.cashLog(e));
      }
      return next;
    });
  }, []);

  const setTables = useCallback((v) => {
    setTablesRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_tables", next); broadcast("nc_tables", next);
      if (SUPABASE_READY) {
        next.forEach(t => {
          const old = p.find(x => x.id === t.id);
          if (!old || old.status !== t.status || old.orderId !== t.orderId || old.note !== t.note)
            sbWrite.table(t);
        });
      }
      return next;
    });
  }, []);

  const setDebts = useCallback((v) => {
    setDebtsRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_debts", next); broadcast("nc_debts", next);
      if (SUPABASE_READY) {
        next.forEach(d => {
          const old = p.find(x => x.id === d.id);
          if (!old || old.remaining !== d.remaining || old.settled !== d.settled) sbWrite.debt(d);
        });
      }
      return next;
    });
  }, []);

  const setExpenses = useCallback((v) => {
    setExpensesRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_expenses", next); broadcast("nc_expenses", next);
      if (SUPABASE_READY) {
        const prevIds = new Set(p.map(e => e.id));
        next.filter(e => !prevIds.has(e.id)).forEach(e => sbWrite.expense(e));
      }
      return next;
    });
  }, []);

  const setReceipts = useCallback((v) => {
    setReceiptsRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_receipts", next); broadcast("nc_receipts", next);
      if (SUPABASE_READY) {
        const prevIds = new Set(p.map(r => r.id));
        next.filter(r => !prevIds.has(r.id)).forEach(r => sbWrite.receipt(r));
      }
      return next;
    });
  }, []);

  const setSettings = useCallback((v) => {
    setSettingsRaw(p => {
      const d = typeof v === "function" ? v(p) : v;
      ls.set("nc_settings", d); broadcast("nc_settings", d); return d;
    });
  }, []);

  // ── إضافة طاولات جديدة (طاولة طاولة) ─────────────────────
  const addTable = useCallback(() => {
    setTablesRaw(p => {
      const maxNum = p.length > 0 ? Math.max(...p.map(t => t.number)) : 0;
      const newNum = maxNum + 1;
      const newTable = {
        id: `tbl_${newNum}_${Date.now()}`,
        number: newNum, num: String(newNum),
        label: `طاولة ${newNum}`,
        seats: 4, status: "free",
        note: "", orderId: null, openedAt: null,
      };
      const next = [...p, newTable];
      ls.set("nc_tables", next); broadcast("nc_tables", next);
      if (SUPABASE_READY) sbWrite.table(newTable);
      return next;
    });
  }, []);

  // ── BroadcastChannel ───────────────────────────────────────
  useEffect(() => {
    if (!bc) return;
    const handler = (e) => {
      const { key, data } = e.data;
      switch (key) {
        case "nc_users":    setUsersRaw(data);        break;
        case "nc_menu":     setMenuRaw(data);          break;
        case "nc_orders":   setOrdersRaw(data);        break;
        case "nc_notifs":   setNotificationsRaw(data); break;
        case "nc_cash":     setCashLogRaw(data);       break;
        case "nc_tables":   setTablesRaw(data);        break;
        case "nc_debts":    setDebtsRaw(data);         break;
        case "nc_expenses": setExpensesRaw(data);      break;
        case "nc_receipts": setReceiptsRaw(data);      break;
        case "nc_settings": setSettingsRaw(data);      break;
      }
    };
    bc.addEventListener("message", handler);
    return () => bc.removeEventListener("message", handler);
  }, []);

  // ── storage event ──────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (!e.key || !e.newValue) return;
      try {
        const data = JSON.parse(e.newValue);
        switch (e.key) {
          case "nc_users":    setUsersRaw(data);        break;
          case "nc_menu":     setMenuRaw(data);          break;
          case "nc_orders":   setOrdersRaw(data);        break;
          case "nc_notifs":   setNotificationsRaw(data); break;
          case "nc_cash":     setCashLogRaw(data);       break;
          case "nc_tables":   setTablesRaw(data);        break;
          case "nc_debts":    setDebtsRaw(data);         break;
          case "nc_expenses": setExpensesRaw(data);      break;
          case "nc_receipts": setReceiptsRaw(data);      break;
          case "nc_settings": setSettingsRaw(data);      break;
        }
      } catch {}
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // ══════════════════════════════════════════════════════════
  // تحميل من Supabase عند الفتح
  // ══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!SUPABASE_READY) return;
    setSyncing(true);
    Promise.all([
      supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("menu_items").select("*").order("category"),
      supabase.from("profiles").select("*"),
      supabase.from("debts").select("*").order("date", { ascending: false }),
      supabase.from("expenses").select("*").order("date", { ascending: false }),
      supabase.from("cash_log").select("*").order("at", { ascending: false }).limit(200),
      supabase.from("tables").select("*").order("number"),
      supabase.from("receipts").select("*").order("created_at", { ascending: false }).limit(200),
    ]).then(([ord, men, prof, dbt, exp, cash, tbl, rct]) => {
      if (ord.data?.length)  { const d = ord.data.map(mapOrder);   setOrdersRaw(d);   ls.set("nc_orders",   d); }
      if (men.data?.length)  { const d = men.data.map(mapMenu);    setMenuRaw(d);     ls.set("nc_menu",     d); }
      if (prof.data?.length) { setUsersRaw(prof.data);              ls.set("nc_users", prof.data); }
      if (dbt.data?.length)  { const d = dbt.data.map(mapDebt);    setDebtsRaw(d);    ls.set("nc_debts",    d); }
      if (exp.data?.length)  { const d = exp.data.map(mapExpense);  setExpensesRaw(d); ls.set("nc_expenses", d); }
      if (cash.data?.length) { const d = cash.data.map(mapCash);   setCashLogRaw(d);  ls.set("nc_cash",     d); }
      if (rct.data?.length)  { const d = rct.data.map(mapReceipt); setReceiptsRaw(d); ls.set("nc_receipts", d); }
      if (tbl.data?.length) {
        const d = tbl.data.map(mapTable);
        setTablesRaw(d); ls.set("nc_tables", d);
      }
      setCloudReady(true);
    }).catch(err => {
      console.error("Supabase load error:", err);
    }).finally(() => setSyncing(false));
  }, []);

  // ══════════════════════════════════════════════════════════
  // Realtime subscriptions
  // ══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeOrders(
      (r) => setOrdersRaw(p => { const m = mapOrder(r); const n = [m, ...p.filter(o => o.id !== m.id)]; ls.set("nc_orders", n); broadcast("nc_orders", n); return n; }),
      (r) => setOrdersRaw(p => { const m = mapOrder(r); const n = p.map(o => o.id === m.id ? m : o);    ls.set("nc_orders", n); broadcast("nc_orders", n); return n; }),
      (r) => setOrdersRaw(p => { const n = p.filter(o => o.id !== r.id);                                ls.set("nc_orders", n); broadcast("nc_orders", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeTables((newRow, deletedId) => {
      if (deletedId) {
        setTablesRaw(p => { const n = p.filter(t => t.id !== deletedId); ls.set("nc_tables", n); broadcast("nc_tables", n); return n; });
      } else if (newRow) {
        const t = mapTable(newRow);
        setTablesRaw(p => { const n = [t, ...p.filter(x => x.id !== t.id)]; ls.set("nc_tables", n); broadcast("nc_tables", n); return n; });
      }
    });
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeDebts(
      (r) => setDebtsRaw(p => { const d = mapDebt(r); const n = [d, ...p.filter(x => x.id !== d.id)]; ls.set("nc_debts", n); broadcast("nc_debts", n); return n; }),
      (r) => setDebtsRaw(p => { const d = mapDebt(r); const n = p.map(x => x.id === d.id ? d : x);   ls.set("nc_debts", n); broadcast("nc_debts", n); return n; }),
      (r) => setDebtsRaw(p => { const n = p.filter(x => x.id !== r.id);                               ls.set("nc_debts", n); broadcast("nc_debts", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY || !supabase) return;
    const ch = supabase.channel("profiles-rt-v4")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (p) => {
        if (p.eventType === "INSERT" || p.eventType === "UPDATE") {
          setUsersRaw(prev => { const n = [p.new, ...prev.filter(u => u.id !== p.new.id)]; ls.set("nc_users", n); broadcast("nc_users", n); return n; });
        }
        if (p.eventType === "DELETE") {
          setUsersRaw(prev => { const n = prev.filter(u => u.id !== p.old.id); ls.set("nc_users", n); broadcast("nc_users", n); return n; });
        }
      }).subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeMenu(
      (r) => setMenuRaw(p => { const m = mapMenu(r); const n = [m, ...p.filter(x => x.id !== m.id)]; ls.set("nc_menu", n); broadcast("nc_menu", n); return n; }),
      (r) => setMenuRaw(p => { const m = mapMenu(r); const n = p.map(x => x.id === m.id ? m : x);   ls.set("nc_menu", n); broadcast("nc_menu", n); return n; }),
      (r) => setMenuRaw(p => { const n = p.filter(x => x.id !== r.id);                               ls.set("nc_menu", n); broadcast("nc_menu", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeExpenses(
      (r) => setExpensesRaw(p => { const e = mapExpense(r); const n = [e, ...p.filter(x => x.id !== e.id)]; ls.set("nc_expenses", n); broadcast("nc_expenses", n); return n; }),
      (r) => setExpensesRaw(p => { const e = mapExpense(r); const n = p.map(x => x.id === e.id ? e : x);   ls.set("nc_expenses", n); broadcast("nc_expenses", n); return n; }),
      (r) => setExpensesRaw(p => { const n = p.filter(x => x.id !== r.id);                                  ls.set("nc_expenses", n); broadcast("nc_expenses", n); return n; }),
    );
  }, []);

  return {
    users, setUsers,
    menu, setMenu,
    orders, setOrders,
    notifications, setNotifications,
    cashLog, setCashLog,
    tables, setTables, addTable,
    debts, setDebts,
    expenses, setExpenses,
    receipts, setReceipts,
    settings, setSettings,
    syncing, cloudReady,
  };
};
