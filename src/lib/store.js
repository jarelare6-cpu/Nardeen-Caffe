// src/lib/store.js — Nardeen Caffe v6.0
// ══════════════════════════════════════════════════════════════
// تحسينات v6:
//  1. تشفير كلمات المرور (hashPassword)
//  2. setReceipts يرفع لـ Supabase (مُصلح)
//  3. setCashLog يرفع لـ Supabase (مُصلح)
//  4. session timeout (30 دقيقة)
//  5. تنبيه نفاد المخزون عند الوصول لـ minStock
//  6. subscribeReceipts مربوط بـ store
// ══════════════════════════════════════════════════════════════
import { useState, useCallback, useEffect } from "react";
import {
  supabase, SUPABASE_READY,
  sbUpsert, sbDelete,
  hashPassword,
  subscribeOrders, subscribeTables,
  subscribeDebts, subscribeExpenses, subscribeMenu,
  subscribeReceipts, subscribeCompLog, subscribeCustomers,
  subscribeSettings, subscribePermOverrides,
  subscribeShifts, subscribeLoyaltyLog, subscribeCashLog,
  sbSaveSettings, sbSavePermOverrides, sbDeleteAll,
} from "./supabase";

// ── تخزين: offline-first — حفظ محلي + Supabase كمصدر حقيقة عند الاتصال ──
// كل المجموعات تُحفظ محليًا (localStorage) ليعمل التطبيق دون إنترنت ويصمد
// أمام التحديث/إعادة التشغيل. عند الاتصال يُحدّثها التحميل من Supabase.
const ls = {
  get: (k, def) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch { return def; }
  },
  set: (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  },
};

// ── BroadcastChannel ──────────────────────────────────────────
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("nardeen_v6") : null;
const broadcast = (key, data) => { if (bc) bc.postMessage({ key, data, ts: Date.now() }); };

// ══════════════════════════════════════════════════════════════
// SESSION TIMEOUT — 30 دقيقة خمول
// ══════════════════════════════════════════════════════════════
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

export const checkSessionExpiry = () => {
  try {
    const raw = sessionStorage.getItem("nc_session");
    if (!raw) return null;
    const session = JSON.parse(raw);
    const lastActive = session._lastActive || session.lastLogin;
    if (lastActive && Date.now() - new Date(lastActive).getTime() > SESSION_TIMEOUT_MS) {
      sessionStorage.removeItem("nc_session");
      return null;
    }
    return session;
  } catch {
    return null;
  }
};

export const touchSession = (user) => {
  try {
    const updated = { ...user, _lastActive: new Date().toISOString() };
    sessionStorage.setItem("nc_session", JSON.stringify(updated));
    return updated;
  } catch { return user; }
};

// ══════════════════════════════════════════════════════════════
// الطاولات الافتراضية
// ══════════════════════════════════════════════════════════════
export const buildDefaultTables = (count = 20) =>
  Array.from({ length: count }, (_, i) => ({
    id: `tbl_${i + 1}`, number: i + 1, num: String(i + 1),
    label: `طاولة ${i + 1}`, seats: 4, status: "free",
    note: "", orderId: null, openedAt: null, branch: "main",
  }));

export const buildOutdoorTables = (count = 10) =>
  Array.from({ length: count }, (_, i) => ({
    id: `out_${i + 1}`, number: i + 1, num: String(i + 1),
    label: `حديقة ${i + 1}`, seats: 4, status: "free",
    note: "", orderId: null, openedAt: null, branch: "outdoor",
  }));

// ══════════════════════════════════════════════════════════════
// الإعدادات الافتراضية
// ══════════════════════════════════════════════════════════════
export const DEFAULT_SETTINGS = {
  cafeName: "ناردين كافيه",
  signature: "بإدارة يحيى داؤود",
  currency: "ل.س",
  maxDiscount: 50,
  workerCanDecreaseStock: false,
  cashierCanSeeReports: true,
  allowCustomerOrders: true,
  taxPercent: 0,
  appLang: "ar",
  cashierCode: "narden",
  appTheme: "default",
  defaultTableCount: 20,
  soundEnabled: false,
  soundOnReady: false,
  soundOnDebt: false,
  soundTone: "bell",
  notifyBrowser: false,
  openTableSystem: true,
  autoFreeTable: true,
  tableTimerAlert: false,
  tableAlertMinutes: 60,
  mergeTableOrders: false,
  requireTableOnOrder: true,
  printOnNewOrder: false,
  // نظام الولاء
  loyaltyEnabled: true,
  loyaltyVisitsForReward: 10,  // عدد الزيارات للحصول على مكافأة
  loyaltyDiscountPercent: 10,  // نسبة الخصم عند تحقق المكافأة
};

// ══════════════════════════════════════════════════════════════
// المستخدمون الافتراضيون — كلمات المرور ستُشفَّر عند أول تشغيل
// ══════════════════════════════════════════════════════════════
export const DEFAULT_USERS_PLAIN = [
  { id:"u1",         username:"admin",      password:"admin1",    role:"admin",   name:"يحيى داؤود",    email:"admin@nardeen.cafe",      active:true, shift:null },
  { id:"u2",         username:"cashier_am", password:"Cash@AM24", role:"cashier", name:"كاشير الصباح",  email:"cashier.am@nardeen.cafe", active:true, shift:"صباحي" },
  { id:"u3",         username:"cashier_pm", password:"Cash@PM24", role:"cashier", name:"كاشير المساء",  email:"cashier.pm@nardeen.cafe", active:true, shift:"مسائي" },
  { id:"u4",         username:"bar1",       password:"Bar@AM24",  role:"bar",     name:"بار الصباح",    email:"bar1@nardeen.cafe",       active:true, shift:"صباحي" },
  { id:"u5",         username:"bar2",       password:"Bar@PM24",  role:"bar",     name:"بار المساء",    email:"bar2@nardeen.cafe",       active:true, shift:"مسائي" },
  { id:"u6",         username:"hookah1",    password:"Hook@AM24", role:"hookah",  name:"أراكيل الصباح", email:"hookah1@nardeen.cafe",    active:true, shift:"صباحي" },
  { id:"u7",         username:"hookah2",    password:"Hook@PM24", role:"hookah",  name:"أراكيل المساء", email:"hookah2@nardeen.cafe",    active:true, shift:"مسائي" },
  { id:"u8",         username:"worker1",    password:"Work@AM24", role:"worker",  name:"عامل الصباح",   email:"worker1@nardeen.cafe",    active:true, shift:"صباحي" },
  { id:"u9",         username:"worker2",    password:"Work@PM24", role:"worker",  name:"عامل المساء",   email:"worker2@nardeen.cafe",    active:true, shift:"مسائي" },
  { id:"u_outdoor1", username:"outdoor1",   password:"Out@2024",  role:"outdoor", name:"عامل الحديقة",  email:"outdoor@nardeen.cafe",    active:true, shift:null },
];

// تشفير المستخدمين الافتراضيين عند أول استخدام
export const getHashedDefaultUsers = async () => {
  const users = [];
  for (const u of DEFAULT_USERS_PLAIN) {
    users.push({ ...u, password: await hashPassword(u.password) });
  }
  return users;
};

export const DEFAULT_MENU = [
  { id:"ck1",  name:'كوكتيل فواكه',            nameEn:"Fruit Cocktail",           price:200, category:"cold_drinks", stock:40,  minStock:5,  totalSold:0, emoji:"🍹", active:true },
  { id:"ck2",  name:'كوكتيل "ناردين"',          nameEn:"Nardeen Cocktail",         price:200, category:"cold_drinks", stock:40,  minStock:5,  totalSold:0, emoji:"🍹", active:true },
  { id:"ck3",  name:"كوكتيل موز حليب وفريز",    nameEn:"Banana Milk Strawberry",   price:200, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍹", active:true },
  { id:"ck4",  name:"كوكتيل موز وحليب",         nameEn:"Banana Milk",              price:180, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍹", active:true },
  { id:"ck5",  name:"كوكتيل موز حليب شوكولا",   nameEn:"Banana Choc Milkshake",    price:200, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍹", active:true },
  { id:"ck6",  name:"كوكتيل موز حليب منغا",     nameEn:"Banana Mango Milkshake",   price:200, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍹", active:true },
  { id:"ck7",  name:"كوكتيل موز برتقال",        nameEn:"Banana Orange",            price:200, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍹", active:true },
  { id:"ck8",  name:"كوكتيل موز فريز شوكولا",   nameEn:"Banana Straw Choc",        price:200, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍹", active:true },
  { id:"ck9",  name:"كوكتيل حليب فريز",         nameEn:"Milk Strawberry",          price:180, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍹", active:true },
  { id:"j1",   name:"عصير جزر وبرتقال",         nameEn:"Carrot Orange Juice",      price:100, category:"cold_drinks", stock:40,  minStock:5,  totalSold:0, emoji:"🥤", active:true },
  { id:"j2",   name:"عصير منغا",                nameEn:"Mango Juice",              price:100, category:"cold_drinks", stock:40,  minStock:5,  totalSold:0, emoji:"🥭", active:true },
  { id:"j3",   name:"عصير برتقال",              nameEn:"Orange Juice",             price:100, category:"cold_drinks", stock:40,  minStock:5,  totalSold:0, emoji:"🍊", active:true },
  { id:"j4",   name:"عصير أناناس",              nameEn:"Pineapple Juice",          price:100, category:"cold_drinks", stock:40,  minStock:5,  totalSold:0, emoji:"🍍", active:true },
  { id:"j5",   name:"عصير أناناس فريش",         nameEn:"Fresh Pineapple Juice",    price:180, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍍", active:true },
  { id:"j6",   name:"عصير فريز",                nameEn:"Strawberry Juice",         price:180, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍓", active:true },
  { id:"j7",   name:"عصير توت",                 nameEn:"Berry Juice",              price:160, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🫐", active:true },
  { id:"j8",   name:"عصير ليمونادا",            nameEn:"Lemonade",                 price:160, category:"cold_drinks", stock:40,  minStock:5,  totalSold:0, emoji:"🍋", active:true },
  { id:"j9",   name:"عصير بولو",                nameEn:"Polo Juice",               price:160, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🥤", active:true },
  { id:"j10",  name:"عصير فريز وتوت",           nameEn:"Strawberry Berry Juice",   price:160, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍓", active:true },
  { id:"j11",  name:"عصير رمان",                nameEn:"Pomegranate Juice",        price:130, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍎", active:true },
  { id:"ms1",  name:"ميلك شيك فريز",            nameEn:"Strawberry Milkshake",     price:230, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🥛", active:true },
  { id:"ms2",  name:"ميلك شيك شوكولا",          nameEn:"Chocolate Milkshake",      price:230, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🥛", active:true },
  { id:"ms3",  name:"ميلك شيك فانيل",           nameEn:"Vanilla Milkshake",        price:230, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🥛", active:true },
  { id:"ms4",  name:"ميلك شيك أوريو",           nameEn:"Oreo Milkshake",           price:230, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🥛", active:true },
  { id:"ms5",  name:"ميلك شيك تشيز كيك",        nameEn:"Cheesecake Milkshake",     price:230, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🥛", active:true },
  { id:"ms6",  name:"ميلك شيك سيريلاك",         nameEn:"Cerelac Milkshake",        price:230, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🥛", active:true },
  { id:"ms7",  name:"ميلك شيك مارشميلو",        nameEn:"Marshmallow Milkshake",    price:230, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🥛", active:true },
  { id:"ms8",  name:'ميلك شيك "ناردين"',         nameEn:"Nardeen Milkshake",        price:230, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🥛", active:true },
  { id:"ic1",  name:"أيس أوريو",                nameEn:"Oreo Ice",                 price:180, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🧊", active:true },
  { id:"ic2",  name:"أيس ميلو",                 nameEn:"Milo Ice",                 price:180, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🧊", active:true },
  { id:"ic3",  name:"أيس 3 ب 1",               nameEn:"3in1 Ice",                 price:180, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🧊", active:true },
  { id:"ic4",  name:"أيس كابتشينو",             nameEn:"Cappuccino Ice",           price:180, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🧊", active:true },
  { id:"ic5",  name:"أيس شوكليت",               nameEn:"Chocolate Ice",            price:180, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🧊", active:true },
  { id:"ic6",  name:"أيس كافي",                 nameEn:"Ice Coffee",               price:180, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🧊", active:true },
  { id:"ic7",  name:"أيس دراق فريش",            nameEn:"Fresh Peach Ice",          price:160, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🍑", active:true },
  { id:"ic8",  name:"أيس ميلو موز",             nameEn:"Milo Banana Ice",          price:190, category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🧊", active:true },
  { id:"m1",   name:"ميلو",                     nameEn:"Milo",                     price:10,  category:"hot_drinks",  stock:100, minStock:10, totalSold:0, emoji:"☕", active:true },
  { id:"m2",   name:"ميلو مع حليب",             nameEn:"Milo with Milk",           price:150, category:"hot_drinks",  stock:80,  minStock:10, totalSold:0, emoji:"☕", active:true },
  { id:"m3",   name:"نسكافيه",                  nameEn:"Nescafe",                  price:100, category:"hot_drinks",  stock:80,  minStock:10, totalSold:0, emoji:"☕", active:true },
  { id:"m4",   name:"كابتشينو",                 nameEn:"Cappuccino",               price:100, category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"☕", active:true },
  { id:"m5",   name:"3 ب 1",                    nameEn:"3 in 1",                   price:100, category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"☕", active:true },
  { id:"m6",   name:"3 ب 1 نسله",               nameEn:"Nestle 3in1",              price:130, category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"☕", active:true },
  { id:"m7",   name:"2 ب 1",                    nameEn:"2 in 1",                   price:100, category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"☕", active:true },
  { id:"m8",   name:"قهوة تركية",               nameEn:"Turkish Coffee",           price:100, category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"☕", active:true },
  { id:"m9",   name:"شاي أخضر",                 nameEn:"Green Tea",                price:100, category:"hot_drinks",  stock:80,  minStock:10, totalSold:0, emoji:"🍵", active:true },
  { id:"m10",  name:"شاي أحمر",                 nameEn:"Red Tea",                  price:100, category:"hot_drinks",  stock:80,  minStock:10, totalSold:0, emoji:"🍵", active:true },
  { id:"m11",  name:"شاي خمير",                 nameEn:"Khamir Tea",               price:100, category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"🍵", active:true },
  { id:"m12",  name:"زهورات",                   nameEn:"Herbal Tea",               price:100, category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"🌸", active:true },
  { id:"m13",  name:"متة",                      nameEn:"Mate",                     price:100, category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"🍵", active:true },
  { id:"m14",  name:"متة مع زهورات",            nameEn:"Mate & Herbal",            price:120, category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"🍵", active:true },
  { id:"m15",  name:"كمون وليمون",              nameEn:"Cumin & Lemon",            price:100, category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"🍋", active:true },
  { id:"m16",  name:"هوت شوكليت",               nameEn:"Hot Chocolate",            price:100, category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"🍫", active:true },
  { id:"m17",  name:"هوت شوكليت مع حليب",       nameEn:"Hot Choc with Milk",       price:150, category:"hot_drinks",  stock:50,  minStock:8,  totalSold:0, emoji:"🍫", active:true },
  { id:"m18",  name:"نسكافيه مع حليب",          nameEn:"Nescafe with Milk",        price:150, category:"hot_drinks",  stock:50,  minStock:8,  totalSold:0, emoji:"☕", active:true },
  { id:"mc1",  name:"كولا",                     nameEn:"Cola",                     price:100, category:"cold_drinks", stock:80,  minStock:10, totalSold:0, emoji:"🥤", active:true },
  { id:"mc2",  name:"سفن أب",                   nameEn:"7Up",                      price:100, category:"cold_drinks", stock:80,  minStock:10, totalSold:0, emoji:"🥤", active:true },
  { id:"mc3",  name:"ميرندا تفاح",              nameEn:"Mirinda Apple",            price:100, category:"cold_drinks", stock:60,  minStock:8,  totalSold:0, emoji:"🥤", active:true },
  { id:"mc4",  name:"ميرندا برتقال",            nameEn:"Mirinda Orange",           price:100, category:"cold_drinks", stock:60,  minStock:8,  totalSold:0, emoji:"🥤", active:true },
  { id:"mc5",  name:"مياه كبيرة",               nameEn:"Large Water",              price:80,  category:"cold_drinks", stock:100, minStock:20, totalSold:0, emoji:"💧", active:true },
  { id:"mc6",  name:"مياه صغيرة",               nameEn:"Small Water",              price:40,  category:"cold_drinks", stock:100, minStock:20, totalSold:0, emoji:"💧", active:true },
  { id:"hk1",  name:"أركيلة تفاحتين",           nameEn:"Double Apple Hookah",      price:150, category:"hookah",      stock:50,  minStock:5,  totalSold:0, emoji:"💨", active:true },
  { id:"hk2",  name:"أركيلة بولو",              nameEn:"Polo Hookah",              price:130, category:"hookah",      stock:50,  minStock:5,  totalSold:0, emoji:"💨", active:true },
  { id:"hk3",  name:"أركيلة لوف",               nameEn:"Love Hookah",              price:130, category:"hookah",      stock:50,  minStock:5,  totalSold:0, emoji:"💨", active:true },
  { id:"hk4",  name:"أركيلة علكة",              nameEn:"Gum Hookah",               price:130, category:"hookah",      stock:50,  minStock:5,  totalSold:0, emoji:"💨", active:true },
  { id:"hk5",  name:"أركيلة عنب",               nameEn:"Grape Hookah",             price:130, category:"hookah",      stock:50,  minStock:5,  totalSold:0, emoji:"💨", active:true },
  { id:"hk6",  name:"أركيلة خارجية",            nameEn:"External Hookah",          price:200, category:"hookah",      stock:20,  minStock:3,  totalSold:0, emoji:"💨", active:true },
  { id:"hkx1", name:"أركيلة خارجية - تفاحتين",  nameEn:"External Hookah - Apple",  price:200, category:"hookah",      stock:20,  minStock:3,  totalSold:0, emoji:"💨", active:true },
  { id:"hkx2", name:"أركيلة خارجية - عنب",      nameEn:"External Hookah - Grape",  price:200, category:"hookah",      stock:20,  minStock:3,  totalSold:0, emoji:"💨", active:true },
  { id:"hkx3", name:"أركيلة خارجية - نعناع",    nameEn:"External Hookah - Mint",   price:200, category:"hookah",      stock:20,  minStock:3,  totalSold:0, emoji:"💨", active:true },
];

// ══════════════════════════════════════════════════════════════
// كتابة إلى Supabase
// ══════════════════════════════════════════════════════════════
const sbWrite = {
  user: async (u) => {
    const pw = await hashPassword(u.password);
    const core = { id: u.id, username: u.username, password: pw, role: u.role, name: u.name, active: u.active };
    return sbUpsert("profiles", { ...core, email: u.email || "", shift: u.shift || null }, "id", core);
  },
  deleteUser: (id) => sbDelete("profiles", id),

  menuItem: (m) => {
    const core = {
      id: m.id, name: m.name, name_en: m.nameEn || "",
      price: m.price, category: m.category,
      stock: m.stock, min_stock: m.minStock || 5,
      total_sold: m.totalSold || 0, emoji: m.emoji || "",
      active: m.active !== false,
      outdoor_price: m.outdoorPrice ?? null,
      image_url: m.image || m.imageUrl || "",
    };
    return sbUpsert("menu_items", { ...core, image_icon: m.imageIcon || "", cost: m.cost ?? 0 }, "id", core);
  },
  deleteMenuItem: (id) => sbDelete("menu_items", id),

  order: (o) => sbUpsert("orders", {
    id: o.id, order_num: o.orderNum,
    customer_name: o.customerName, customer_id: o.customerId || null,
    table_num: o.table || "", items: o.items,
    total: o.total, discount: o.discount || 0,
    status: o.status, payment_type: o.paymentType || "cash",
    payment_status: o.paymentStatus || "pending",
    partial_paid: o.partialPaid || 0,
    notes: o.notes || "", created_at: o.createdAt,
    paid_at: o.paidAt || null, paid_by: o.paidBy || null,
    paid_by_name: o.paidByName || "",
    is_debt_settlement: o.isDebtSettlement || false,
    original_total: o.originalTotal || null,
    comp_amount: o.compAmount || 0,
    is_complimentary: o.isComplimentary || false,
    worker_name: o.workerName || "",
    tron_amount: o.tronAmount || 0,
    branch: o.branch || "main",
    shift_id: o.shiftId || null,
    preparing_at: o.preparingAt || null,
    ready_at: o.readyAt || null,
  }),
  deleteOrder: (id) => sbDelete("orders", id),

  table: (t) => sbUpsert("tables", {
    id: t.id, number: t.number || 0, num: String(t.number || ""),
    label: t.label || `طاولة ${t.number}`,
    seats: t.seats || 4, status: t.status || "free",
    note: t.note || "", order_id: t.orderId || null,
    opened_at: t.openedAt || null,
    branch: t.branch || "main",
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

  // ✅ cash_log يُكتب لـ Supabase
  cashLog: (e) => sbUpsert("cash_log", {
    id: e.id, order_id: e.orderId || null,
    order_num: e.orderNum || "", amount: e.amount,
    at: e.at, by: e.by || "", type: e.type || "sale",
    branch: e.branch || "main",
  }),

  // ✅ receipts تُكتب لـ Supabase
  receipt: (r) => sbUpsert("receipts", {
    id: r.id, order_id: r.orderId || null,
    order_num: r.orderNum || "", customer_name: r.customerName || "",
    table_num: r.tableNum || "", items: r.items || [],
    total: r.total || 0, discount: r.discount || 0,
    payment_type: r.paymentType || "cash", notes: r.notes || "",
    created_by: r.createdBy || "", created_at: r.createdAt || new Date().toISOString(),
    cafe_name: r.cafeName || "Nardeen Caffe",
    tron_amount: r.tronAmount || 0,
    branch: r.branch || "main",
  }),

  compLog: (c) => sbUpsert("comp_log", {
    id: c.id, order_id: c.orderId || null,
    order_num: c.orderNum || "", customer_name: c.customerName || "",
    table_num: String(c.tableNum || c.table || ""),
    items: c.items || [], amount: c.amount || 0,
    reason: c.reason || "", created_by: c.createdBy || c.by || "",
    created_at: c.createdAt || c.at || new Date().toISOString(),
    branch: c.branch || "main",
  }),

  customer: (c) => sbUpsert("customers", {
    id: c.id, name: c.name || "",
    phone: c.phone || "", email: c.email || "",
    visits: c.visits || 0,
    total_orders: c.totalOrders || 0,
    total_spent: c.totalSpent || 0,
    notes: c.notes || "",
    loyalty_points: c.loyaltyPoints || 0,
    loyalty_redeemed: c.loyaltyRedeemed || 0,
    tier: c.tier || "bronze",
    created_at: c.createdAt || new Date().toISOString(),
    last_visit: c.lastVisit || null,
    orders: c.orders || [],
  }),
  deleteCustomer: (id) => sbDelete("customers", id),

  // v7: تقفيل الوردية
  shift: (s) => sbUpsert("shifts", {
    id: s.id, user_id: s.userId || null, user_name: s.userName || "",
    branch: s.branch || "main",
    opened_at: s.openedAt || new Date().toISOString(),
    closed_at: s.closedAt || null,
    opening_cash: s.openingCash || 0,
    expected_cash: s.expectedCash || 0,
    counted_cash: s.countedCash || 0,
    difference: s.difference || 0,
    total_sales: s.totalSales || 0,
    cash_sales: s.cashSales || 0,
    card_sales: s.cardSales || 0,
    tron_sales: s.tronSales || 0,
    debt_total: s.debtTotal || 0,
    comp_total: s.compTotal || 0,
    orders_count: s.ordersCount || 0,
    expenses_total: s.expensesTotal || 0,
    status: s.status || "open",
    notes: s.notes || "",
    created_at: s.createdAt || new Date().toISOString(),
  }),

  // v7: محفظة الولاء
  loyaltyLog: (l) => sbUpsert("loyalty_log", {
    id: l.id, customer_id: l.customerId || null,
    customer_name: l.customerName || "",
    type: l.type || "earn", points: l.points || 0,
    order_id: l.orderId || null, order_num: l.orderNum || "",
    note: l.note || "", created_by: l.createdBy || "",
    created_at: l.createdAt || new Date().toISOString(),
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
  paymentStatus:o.payment_status?? o.paymentStatus?? "pending",
  partialPaid:  o.partial_paid  ?? o.partialPaid  ?? 0,
  createdAt:    o.created_at    ?? o.createdAt    ?? new Date().toISOString(),
  paidAt:       o.paid_at       ?? o.paidAt       ?? null,
  paidBy:       o.paid_by       ?? o.paidBy       ?? null,
  paidByName:   o.paid_by_name  ?? o.paidByName   ?? "",
  isDebtSettlement: o.is_debt_settlement ?? o.isDebtSettlement ?? false,
  originalTotal: o.original_total ?? o.originalTotal ?? null,
  compAmount:   o.comp_amount   ?? o.compAmount   ?? 0,
  isComplimentary: o.is_complimentary ?? o.isComplimentary ?? false,
  workerName:   o.worker_name   ?? o.workerName   ?? "",
  tronAmount:   o.tron_amount   ?? o.tronAmount   ?? 0,
  branch:       o.branch        ?? "main",
  shiftId:      o.shift_id      ?? o.shiftId      ?? null,
  preparingAt:  o.preparing_at  ?? o.preparingAt  ?? null,
  readyAt:      o.ready_at       ?? o.readyAt      ?? null,
});
const mapMenu = m => ({
  ...m,
  nameEn:       m.name_en      ?? m.nameEn      ?? "",
  minStock:     m.min_stock    ?? m.minStock     ?? 5,
  totalSold:    m.total_sold   ?? m.totalSold    ?? 0,
  outdoorPrice: m.outdoor_price ?? m.outdoorPrice ?? null,
  image:        m.image_url    ?? m.image       ?? "",
  imageIcon:    m.image_icon   ?? m.imageIcon   ?? "",
  cost:         m.cost         ?? 0,
});
const mapDebt = d => ({
  ...d,
  customerName: d.customer_name ?? d.customerName ?? "",
  settledAt:    d.settled_at    ?? d.settledAt    ?? null,
  createdBy:    d.created_by    ?? d.createdBy    ?? "",
  orderId:      d.order_id      ?? d.orderId      ?? null,
  orderNum:     d.order_num     ?? d.orderNum     ?? "",
  branch:       d.branch        ?? "main",
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
  branch:   t.branch || "main",
});
const mapCash = e => ({
  ...e,
  orderId:  e.order_id  ?? e.orderId  ?? null,
  orderNum: e.order_num ?? e.orderNum ?? "",
  branch:   e.branch    ?? "main",
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
  branch:       r.branch        ?? "main",
});
const mapCompLog = c => ({
  ...c,
  orderId:      c.order_id      ?? c.orderId      ?? null,
  orderNum:     c.order_num     ?? c.orderNum     ?? "",
  customerName: c.customer_name ?? c.customerName ?? "",
  tableNum:     c.table_num     ?? c.tableNum     ?? "",
  createdBy:    c.created_by    ?? c.createdBy    ?? c.by ?? "",
  createdAt:    c.created_at    ?? c.createdAt    ?? c.at ?? new Date().toISOString(),
  branch:       c.branch        ?? "main",
});
const mapCustomer = c => ({
  ...c,
  visits:       c.visits       ?? 0,
  totalOrders:  c.total_orders ?? c.totalOrders ?? 0,
  totalSpent:   c.total_spent  ?? c.totalSpent  ?? 0,
  loyaltyPoints:c.loyalty_points ?? c.loyaltyPoints ?? 0,
  loyaltyRedeemed: c.loyalty_redeemed ?? c.loyaltyRedeemed ?? 0,
  tier:         c.tier         ?? "bronze",
  phone:        c.phone        ?? "",
  createdAt:    c.created_at   ?? c.createdAt   ?? new Date().toISOString(),
  lastVisit:    c.last_visit   ?? c.lastVisit   ?? null,
  orders:       c.orders       ?? [],
});
const mapShift = s => ({
  ...s,
  userId:        s.user_id       ?? s.userId       ?? null,
  userName:      s.user_name     ?? s.userName     ?? "",
  branch:        s.branch        ?? "main",
  openedAt:      s.opened_at     ?? s.openedAt     ?? null,
  closedAt:      s.closed_at     ?? s.closedAt     ?? null,
  openingCash:   s.opening_cash  ?? s.openingCash  ?? 0,
  expectedCash:  s.expected_cash ?? s.expectedCash ?? 0,
  countedCash:   s.counted_cash  ?? s.countedCash  ?? 0,
  difference:    s.difference    ?? 0,
  totalSales:    s.total_sales   ?? s.totalSales   ?? 0,
  cashSales:     s.cash_sales    ?? s.cashSales    ?? 0,
  cardSales:     s.card_sales    ?? s.cardSales    ?? 0,
  tronSales:     s.tron_sales    ?? s.tronSales    ?? 0,
  debtTotal:     s.debt_total    ?? s.debtTotal    ?? 0,
  compTotal:     s.comp_total    ?? s.compTotal    ?? 0,
  ordersCount:   s.orders_count  ?? s.ordersCount  ?? 0,
  expensesTotal: s.expenses_total ?? s.expensesTotal ?? 0,
  status:        s.status        ?? "open",
  notes:         s.notes         ?? "",
  createdAt:     s.created_at    ?? s.createdAt    ?? new Date().toISOString(),
});
const mapLoyalty = l => ({
  ...l,
  customerId:   l.customer_id   ?? l.customerId   ?? null,
  customerName: l.customer_name ?? l.customerName ?? "",
  orderId:      l.order_id      ?? l.orderId      ?? null,
  orderNum:     l.order_num     ?? l.orderNum     ?? "",
  createdBy:    l.created_by    ?? l.createdBy    ?? "",
  createdAt:    l.created_at    ?? l.createdAt    ?? new Date().toISOString(),
});

// ══════════════════════════════════════════════════════════════
// MAIN STORE HOOK
// ══════════════════════════════════════════════════════════════
export const useStore = () => {
  const [users,         setUsersRaw]        = useState(() => ls.get("nc_users",    DEFAULT_USERS_PLAIN));
  const [menu,          setMenuRaw]          = useState(() => ls.get("nc_menu",     DEFAULT_MENU));
  const [orders,        setOrdersRaw]        = useState(() => ls.get("nc_orders",   []));
  const [notifications, setNotificationsRaw] = useState(() => ls.get("nc_notifs",   []));
  const [cashLog,       setCashLogRaw]       = useState(() => ls.get("nc_cash",     []));
  const [tables,        setTablesRaw]        = useState(() => {
    const saved = ls.get("nc_tables", null);
    return saved && saved.length > 0 ? saved : buildDefaultTables(20);
  });
  const [outdoorTables, setOutdoorTablesRaw] = useState(() => {
    const saved = ls.get("nc_outdoor_tables", null);
    return saved && saved.length > 0 ? saved : buildOutdoorTables(10);
  });
  const [debts,         setDebtsRaw]         = useState(() => ls.get("nc_debts",    []));
  const [expenses,      setExpensesRaw]      = useState(() => ls.get("nc_expenses", []));
  const [receipts,      setReceiptsRaw]      = useState(() => ls.get("nc_receipts", []));
  const [settings,      setSettingsRaw]      = useState(() => ({ ...DEFAULT_SETTINGS, ...ls.get("nc_settings", {}) }));
  const [compLog,       setCompLogRaw]       = useState(() => ls.get("nc_complog",  []));
  const [customers,     setCustomersRaw]     = useState(() => ls.get("nc_customers",[]));
  const [permOverrides, setPermOverridesRaw] = useState(() => ls.get("nc_perms",   {}));
  const [shifts,        setShiftsRaw]        = useState(() => ls.get("nc_shifts",   []));
  const [loyaltyLog,    setLoyaltyLogRaw]    = useState(() => ls.get("nc_loyalty",  []));
  const [syncing,       setSyncing]          = useState(false);
  const [cloudReady,    setCloudReady]       = useState(false);

  // ── تشفير كلمات المرور الافتراضية محلياً عند أول تشغيل ──────────
  // مهم: لا نرفع المستخدمين الافتراضيين هنا إطلاقاً، حتى لا نكتب فوق
  // كلمات مرور مُعدّلة موجودة في Supabase. البذر يتم في تأثير التحميل
  // أدناه فقط عندما يكون جدول profiles فارغاً تماماً.
  useEffect(() => {
    const alreadyHashed = ls.get("nc_pw_hashed", false);
    if (alreadyHashed) return;
    getHashedDefaultUsers().then(hashed => {
      setUsersRaw(prev => {
        const updated = prev.map(u => {
          const h = hashed.find(x => x.id === u.id);
          if (h && !/^[a-f0-9]{64}$/i.test(u.password)) return { ...u, password: h.password };
          return u;
        });
        ls.set("nc_users", updated);
        ls.set("nc_pw_hashed", true);
        return updated;
      });
    });
  }, []);

  // ── Setters ───────────────────────────────────────────────

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
      const raw = typeof v === "function" ? v(p) : v;
      // وسم updatedAt على الطلبات المتغيّرة → حلّ التعارض بالطابع الزمني (mesh/محلي).
      // ملاحظة: sbWrite.order يرسل أعمدة محددة فقط، فلا يصل updatedAt لقاعدة البيانات.
      const next = raw.map(o => {
        const old = p.find(x => x.id === o.id);
        const isChanged = !old || old.status !== o.status || old.total !== o.total ||
               old.paymentType !== o.paymentType || old.discount !== o.discount ||
               (old.tronAmount || 0) !== (o.tronAmount || 0) ||
               JSON.stringify(old.items) !== JSON.stringify(o.items);
        return isChanged ? { ...o, updatedAt: new Date().toISOString() } : o;
      });
      ls.set("nc_orders", next); broadcast("nc_orders", next);
      if (SUPABASE_READY) {
        const changed = next.filter(o => {
          const old = p.find(x => x.id === o.id);
          return !old || old.status !== o.status || old.total !== o.total ||
                 old.paymentType !== o.paymentType || old.discount !== o.discount ||
                 (old.tronAmount || 0) !== (o.tronAmount || 0) ||
                 JSON.stringify(old.items) !== JSON.stringify(o.items);
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

  // ✅ cash_log يُرفع لـ Supabase
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

  // ✅ receipts تُرفع لـ Supabase
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
      const stamped = { ...d, _savedAt: new Date().toISOString() };
      ls.set("nc_settings", stamped); broadcast("nc_settings", stamped);
      if (SUPABASE_READY) sbSaveSettings(stamped);
      return stamped;
    });
  }, []);

  const setCompLog = useCallback((v) => {
    setCompLogRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_complog", next); broadcast("nc_complog", next);
      if (SUPABASE_READY) {
        const prevIds = new Set(p.map(c => c.id));
        next.filter(c => !prevIds.has(c.id)).forEach(c => sbWrite.compLog(c));
        const nextIds = new Set(next.map(c => c.id));
        p.filter(c => !nextIds.has(c.id)).forEach(c => sbDelete("comp_log", c.id));
      }
      return next;
    });
  }, []);

  const setCustomers = useCallback((v) => {
    setCustomersRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_customers", next); broadcast("nc_customers", next);
      if (SUPABASE_READY) {
        next.forEach(c => {
          const old = p.find(x => x.id === c.id);
          if (!old || JSON.stringify(old) !== JSON.stringify(c)) sbWrite.customer(c);
        });
        p.forEach(c => { if (!next.find(x => x.id === c.id)) sbWrite.deleteCustomer(c.id); });
      }
      return next;
    });
  }, []);

  const setPermOverrides = useCallback((v) => {
    setPermOverridesRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_perms", next); broadcast("nc_perms", next);
      if (SUPABASE_READY) sbSavePermOverrides(next);
      return next;
    });
  }, []);

  // v7: الورديات — تُرفع لـ Supabase
  const setShifts = useCallback((v) => {
    setShiftsRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_shifts", next); broadcast("nc_shifts", next);
      if (SUPABASE_READY) {
        next.forEach(s => {
          const old = p.find(x => x.id === s.id);
          if (!old || JSON.stringify(old) !== JSON.stringify(s)) sbWrite.shift(s);
        });
      }
      return next;
    });
  }, []);

  // v7: سجل الولاء — يُرفع لـ Supabase
  const setLoyaltyLog = useCallback((v) => {
    setLoyaltyLogRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_loyalty", next); broadcast("nc_loyalty", next);
      if (SUPABASE_READY) {
        const prevIds = new Set(p.map(l => l.id));
        next.filter(l => !prevIds.has(l.id)).forEach(l => sbWrite.loyaltyLog(l));
      }
      return next;
    });
  }, []);

  const addTable = useCallback(() => {
    setTablesRaw(p => {
      const maxNum = p.length > 0 ? Math.max(...p.map(t => t.number)) : 0;
      const newNum = maxNum + 1;
      const newTable = {
        id: `tbl_${newNum}_${Date.now()}`,
        number: newNum, num: String(newNum),
        label: `طاولة ${newNum}`,
        seats: 4, status: "free",
        note: "", orderId: null, openedAt: null, branch: "main",
      };
      const next = [...p, newTable];
      ls.set("nc_tables", next); broadcast("nc_tables", next);
      if (SUPABASE_READY) sbWrite.table(newTable);
      return next;
    });
  }, []);

  const setOutdoorTables = useCallback((v) => {
    setOutdoorTablesRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      ls.set("nc_outdoor_tables", next); broadcast("nc_outdoor_tables", next);
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

  const addOutdoorTable = useCallback(() => {
    setOutdoorTablesRaw(p => {
      const maxNum = p.length > 0 ? Math.max(...p.map(t => t.number)) : 0;
      const newNum = maxNum + 1;
      const newTable = {
        id: `out_${newNum}_${Date.now()}`,
        number: newNum, num: String(newNum),
        label: `حديقة ${newNum}`,
        seats: 4, status: "free",
        note: "", orderId: null, openedAt: null, branch: "outdoor",
      };
      const next = [...p, newTable];
      ls.set("nc_outdoor_tables", next); broadcast("nc_outdoor_tables", next);
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
        case "nc_users":          setUsersRaw(data);        break;
        case "nc_menu":           setMenuRaw(data);          break;
        case "nc_orders":         setOrdersRaw(data);        break;
        case "nc_notifs":         setNotificationsRaw(data); break;
        case "nc_cash":           setCashLogRaw(data);       break;
        case "nc_tables":         setTablesRaw(data);        break;
        case "nc_outdoor_tables": setOutdoorTablesRaw(data); break;
        case "nc_debts":          setDebtsRaw(data);         break;
        case "nc_expenses":       setExpensesRaw(data);      break;
        case "nc_receipts":       setReceiptsRaw(data);      break;
        case "nc_settings":       setSettingsRaw(data);      break;
        case "nc_complog":        setCompLogRaw(data);       break;
        case "nc_customers":      setCustomersRaw(data);     break;
        case "nc_perms":          setPermOverridesRaw(data); break;
        case "nc_shifts":         setShiftsRaw(data);        break;
        case "nc_loyalty":        setLoyaltyLogRaw(data);    break;
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
          case "nc_users":          setUsersRaw(data);        break;
          case "nc_menu":           setMenuRaw(data);          break;
          case "nc_orders":         setOrdersRaw(data);        break;
          case "nc_notifs":         setNotificationsRaw(data); break;
          case "nc_cash":           setCashLogRaw(data);       break;
          case "nc_tables":         setTablesRaw(data);        break;
          case "nc_outdoor_tables": setOutdoorTablesRaw(data); break;
          case "nc_debts":          setDebtsRaw(data);         break;
          case "nc_expenses":       setExpensesRaw(data);      break;
          case "nc_receipts":       setReceiptsRaw(data);      break;
          case "nc_settings":       setSettingsRaw(data);      break;
          case "nc_complog":        setCompLogRaw(data);       break;
          case "nc_customers":      setCustomersRaw(data);     break;
          case "nc_perms":          setPermOverridesRaw(data); break;
          case "nc_shifts":         setShiftsRaw(data);        break;
          case "nc_loyalty":        setLoyaltyLogRaw(data);    break;
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
      supabase.from("tables").select("*").eq("branch","main").order("number"),
      supabase.from("tables").select("*").eq("branch","outdoor").order("number"),
      supabase.from("receipts").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("comp_log").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("customers").select("*").order("created_at", { ascending: false }),
      supabase.from("app_settings").select("*").eq("id", "main").single(),
      supabase.from("perm_overrides").select("*").eq("id", "main").single(),
      supabase.from("shifts").select("*").order("opened_at", { ascending: false }).limit(200),
      supabase.from("loyalty_log").select("*").order("created_at", { ascending: false }).limit(300),
    ]).then(([ord, men, prof, dbt, exp, cash, tbl, outdoorTbl, rct, cmp, cust, sett, perms, shf, loy]) => {
      if (ord.data)  { const d = ord.data.map(mapOrder);    setOrdersRaw(d);   ls.set("nc_orders",   d); } // fix: reset works when empty
      if (men.data?.length)  { const d = men.data.map(mapMenu);     setMenuRaw(d);     ls.set("nc_menu",     d); }
      if (prof.data?.length) { setUsersRaw(prof.data);               ls.set("nc_users", prof.data); }
      else { getHashedDefaultUsers().then(hu => hu.forEach(u => sbWrite.user(u))); }
      if (dbt.data)  { const d = dbt.data.map(mapDebt);     setDebtsRaw(d);    ls.set("nc_debts",    d); }
      if (exp.data)  { const d = exp.data.map(mapExpense);   setExpensesRaw(d); ls.set("nc_expenses", d); }
      if (cash.data) { const d = cash.data.map(mapCash);    setCashLogRaw(d);  ls.set("nc_cash",     d); }
      if (rct.data)  { const d = rct.data.map(mapReceipt);  setReceiptsRaw(d); ls.set("nc_receipts", d); }
      if (tbl.data?.length)  { const d = tbl.data.map(mapTable);    setTablesRaw(d);   ls.set("nc_tables",   d); }
      if (outdoorTbl.data?.length) {
        const d = outdoorTbl.data.map(mapTable);
        setOutdoorTablesRaw(d); ls.set("nc_outdoor_tables", d);
      }
      if (cmp.data)  { const d = cmp.data.map(mapCompLog);  setCompLogRaw(d);  ls.set("nc_complog",  d); }
      if (cust.data) { const d = cust.data.map(mapCustomer);setCustomersRaw(d);ls.set("nc_customers",d); }
      // ✅ fix: إعدادات السحابة تحلّ محلّ المحلية تماماً عند وجودها.
      //         إن كانت السحابة فارغة ({}) نزرع فيها القيم المحلية الحالية.
      if (sett.data != null) {
        const cloudData = sett.data?.data || {};
        const hasCloud = Object.keys(cloudData).length > 0;
        if (hasCloud) {
          // مقارنة الطوابع الزمنية: من هو الأحدث — السحابة أم المحلي؟
          const localRaw = ls.get("nc_settings", {});
          const localTs = localRaw._savedAt ? new Date(localRaw._savedAt).getTime() : 0;
          const cloudTs = cloudData._savedAt ? new Date(cloudData._savedAt).getTime() : 0;
          if (localTs > cloudTs) {
            // المحلي أحدث (مثلاً: تم تغيير إعدادات بعد آخر حفظ سحابي) → المحلي يفوز
            const localFull = { ...DEFAULT_SETTINGS, ...localRaw };
            setSettingsRaw(localFull); ls.set("nc_settings", localFull);
            sbSaveSettings(localFull); // نرفع المحلي للسحابة ليتزامنا
          } else {
            // السحابة أحدث أو متساويان → السحابة تفوز
            const n = { ...DEFAULT_SETTINGS, ...cloudData };
            setSettingsRaw(n); ls.set("nc_settings", n);
          }
        } else {
          // السحابة فارغة → نزرع القيم المحلية فيها الآن
          const localFull = { ...DEFAULT_SETTINGS, ...ls.get("nc_settings", {}) };
          const stamped = { ...localFull, _savedAt: localFull._savedAt || new Date().toISOString() };
          setSettingsRaw(stamped); ls.set("nc_settings", stamped);
          sbSaveSettings(stamped);
        }
      }
      if (perms.data?.data)  { setPermOverridesRaw(perms.data.data); ls.set("nc_perms", perms.data.data); }
      if (shf?.data?.length) { const d = shf.data.map(mapShift);   setShiftsRaw(d);   ls.set("nc_shifts",   d); }
      if (loy?.data?.length) { const d = loy.data.map(mapLoyalty); setLoyaltyLogRaw(d);ls.set("nc_loyalty",  d); }
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
        setOutdoorTablesRaw(p => { const n = p.filter(t => t.id !== deletedId); ls.set("nc_outdoor_tables", n); broadcast("nc_outdoor_tables", n); return n; });
      } else if (newRow) {
        const t = mapTable(newRow);
        if (t.branch === "outdoor") {
          setOutdoorTablesRaw(p => { const n = [t, ...p.filter(x => x.id !== t.id)].sort((a,b)=>a.number-b.number); ls.set("nc_outdoor_tables", n); broadcast("nc_outdoor_tables", n); return n; });
        } else {
          setTablesRaw(p => { const n = [t, ...p.filter(x => x.id !== t.id)].sort((a,b)=>a.number-b.number); ls.set("nc_tables", n); broadcast("nc_tables", n); return n; });
        }
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
    const ch = supabase.channel("profiles-rt-v6")
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

  // ✅ subscribeReceipts مربوط بـ store
  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeReceipts(
      (r) => setReceiptsRaw(p => { const m = mapReceipt(r); const n = [m, ...p.filter(x => x.id !== m.id)]; ls.set("nc_receipts", n); broadcast("nc_receipts", n); return n; }),
      (r) => setReceiptsRaw(p => { const m = mapReceipt(r); const n = p.map(x => x.id === m.id ? m : x);   ls.set("nc_receipts", n); broadcast("nc_receipts", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeCompLog(
      (r) => setCompLogRaw(p => { const c = mapCompLog(r); const n = [c, ...p.filter(x => x.id !== c.id)]; ls.set("nc_complog", n); broadcast("nc_complog", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeCustomers(
      (r) => setCustomersRaw(p => { const c = mapCustomer(r); const n = [c, ...p.filter(x => x.id !== c.id)]; ls.set("nc_customers", n); broadcast("nc_customers", n); return n; }),
      (r) => setCustomersRaw(p => { const c = mapCustomer(r); const n = p.map(x => x.id === c.id ? c : x);   ls.set("nc_customers", n); broadcast("nc_customers", n); return n; }),
      (r) => setCustomersRaw(p => { const n = p.filter(x => x.id !== r.id);                                   ls.set("nc_customers", n); broadcast("nc_customers", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeSettings((row) => {
      if (row?.data) {
        const n = { ...DEFAULT_SETTINGS, ...row.data }; setSettingsRaw(n); ls.set("nc_settings", n); broadcast("nc_settings", n);
      }
    });
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribePermOverrides((row) => {
      if (row?.data) {
        setPermOverridesRaw(() => { ls.set("nc_perms", row.data); broadcast("nc_perms", row.data); return row.data; });
      }
    });
  }, []);

  // v7: subscription لسجل النقد (مهم لتقفيل الوردية عبر الأجهزة)
  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeCashLog(
      (r) => setCashLogRaw(p => { const c = mapCash(r); const n = [c, ...p.filter(x => x.id !== c.id)]; ls.set("nc_cash", n); broadcast("nc_cash", n); return n; }),
      (r) => setCashLogRaw(p => { const n = p.filter(x => x.id !== r.id); ls.set("nc_cash", n); broadcast("nc_cash", n); return n; }),
    );
  }, []);

  // v7: subscriptions للورديات
  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeShifts(
      (r) => setShiftsRaw(p => { const s = mapShift(r); const n = [s, ...p.filter(x => x.id !== s.id)]; ls.set("nc_shifts", n); broadcast("nc_shifts", n); return n; }),
      (r) => setShiftsRaw(p => { const s = mapShift(r); const n = p.map(x => x.id === s.id ? s : x);   ls.set("nc_shifts", n); broadcast("nc_shifts", n); return n; }),
      (r) => setShiftsRaw(p => { const n = p.filter(x => x.id !== r.id);                                ls.set("nc_shifts", n); broadcast("nc_shifts", n); return n; }),
    );
  }, []);

  // v7: subscription لسجل الولاء
  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeLoyaltyLog(
      (r) => setLoyaltyLogRaw(p => { const l = mapLoyalty(r); const n = [l, ...p.filter(x => x.id !== l.id)]; ls.set("nc_loyalty", n); broadcast("nc_loyalty", n); return n; }),
    );
  }, []);

  return {
    users, setUsers,
    menu, setMenu,
    orders, setOrders,
    notifications, setNotifications,
    cashLog, setCashLog,
    tables, setTables, addTable,
    outdoorTables, setOutdoorTables, addOutdoorTable,
    debts, setDebts,
    expenses, setExpenses,
    receipts, setReceipts,
    settings, setSettings,
    compLog, setCompLog,
    customers, setCustomers,
    permOverrides, setPermOverrides,
    shifts, setShifts,
    loyaltyLog, setLoyaltyLog,
    syncing, cloudReady,
  };
};
