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
import { useState, useCallback, useEffect, useRef } from "react";
import {
  supabase, SUPABASE_READY,
  sbUpsert, sbDelete,
  hashPassword,
  subscribeOrders, subscribeTables,
  subscribeDebts, subscribeExpenses, subscribeMenu,
  subscribeReceipts, subscribeCompLog, subscribeCustomers,
  subscribeSettings, subscribePermOverrides,
  subscribeShifts, subscribeLoyaltyLog, subscribeCashLog,
  sbSaveSettings, sbSavePermOverrides, sbDeleteAll, payOrderAtomic,
  enqueueWrite, enqueueDelete, flushOutbox, outboxPendingIds,
  adjustStockAtomic, adjustSupplyAtomic, adjustStockBulkAtomic, subscribeSupplies, subscribeStockMovements,
} from "./supabase";
import {
  rowOfCash, rowOfExpense, rowOfExpenseLegacy, rowOfOrder, mapOrder, mapExpense,
} from "./rows.js";
import {
  rowOfSupply, mapSupply, rowOfMovement, mapMovement, newMoveId, migrateExtraStock,
} from "./stockLog.js";

// ── v22: أونلاين فقط — لا تخزين محلي للبيانات. السحابة هي مصدر الحقيقة الوحيد. ──

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
  lastDailySent: "",   // v42: مفتاح آخر يوم أُرسل جرده (يمنع التكرار بين الأجهزة)
  lastWeeklySent: "",  // v31.2
  requireTableOnOrder: true,
  printOnNewOrder: false,
  telegramTargets: [], // v27: وجهات تليجرام للإدارة [{id,name,token,chatId,events:{}}]
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
  // ── v24: أصناف خدمية خاصة — لا تلمس المخزون، السعر يُحدّده الكاشير ──
  { id:"svc_session", name:"رسم جلسة / دراسة", nameEn:"Session Fee", price:0, category:"services", stock:0, minStock:0, totalSold:0, emoji:"🎟️", active:true, noStock:true, isSession:true },
  { id:"svc_custom",  name:"طلب خاص (شراء وبيع)", nameEn:"Special Order", price:0, category:"services", stock:0, minStock:0, totalSold:0, emoji:"🛒", active:true, noStock:true, isCustom:true },
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
// v22: مُحوّلات صفوف قابلة لإعادة الاستخدام (للدفع الذرّي)
// ══════════════════════════════════════════════════════════════
// v29: رقم فاتورة متسلسل يُصفّر يومياً — عدّاد ذرّي في Supabase
//  الصيغة: YYYYMMDD-NNN. عند تعذّر العدّاد (أوفلاين/قبل الهجرة) يرتدّ
//  لأكبر رقم لهذا اليوم من الطلبات المحمّلة + 1 (آمن الفشل).
// ══════════════════════════════════════════════════════════════
export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

export const getNextInvoiceNum = async (orders) => {
  const day = dayKey();
  if (SUPABASE_READY && supabase && typeof navigator !== "undefined" && navigator.onLine) {
    try {
      const { data, error } = await supabase.rpc("next_invoice_seq", { p_day: day });
      if (!error && data != null) return `${day}-${String(data).padStart(3, "0")}`;
    } catch { /* يرتدّ للحساب المحلي */ }
  }
  const prefix = day + "-";
  let max = 0;
  (orders || []).forEach(o => {
    const on = String(o.orderNum || "");
    if (on.startsWith(prefix)) {
      const n = parseInt(on.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  // v4.7.0: لاحقة جهاز عند الارتداد المحلي (offline) لمنع تطابق الأرقام بين جهازين
  let devSuffix = "";
  try {
    const id = (typeof localStorage !== "undefined" && localStorage.getItem("nc_dev_id")) || "";
    if (id) devSuffix = id.slice(-2).toUpperCase();
  } catch {}
  return `${prefix}${String(max + 1).padStart(3, "0")}${devSuffix ? "-" + devSuffix : ""}`;
};

/* rowOfOrder -> rows.js */
// (المُسلسِلات نُقلت إلى rows.js)

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
    return sbUpsert("menu_items", { ...core, image_icon: m.imageIcon || "", cost: m.cost ?? 0, track_stock: m.trackStock !== false }, "id", core);
  },
  deleteMenuItem: (id) => sbDelete("menu_items", id),

  order: (o) => {
    const row = rowOfOrder(o);
    const { stock_deducted, tron_shift_id, ...legacy } = row;
    return sbUpsert("orders", row, "id", legacy); // fallback لقاعدة لم تُرقَّ بعد
  },
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

  expense: (e) => sbUpsert("expenses", rowOfExpense(e), "id", rowOfExpenseLegacy(e)),

  cashLog: (e) => sbUpsert("cash_log", rowOfCash(e)),

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
    created_at: c.createdAt || c.at || c.date || new Date().toISOString(),
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
  shift: (s) => { const row = {
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
    // v44: مَن أقفل الوردية فعلاً — قد يختلف عن مَن فتحها
    closed_by_id: s.closedById || null,
    closed_by_name: s.closedByName || "",
    notes: s.notes || "",
    shift_type: s.shiftType || "", // v31.6: حفظ نوع الوردية
    created_at: s.createdAt || new Date().toISOString(),
    };
    // v44: fallback لقاعدة لم تُرقَّ بعد (بلا أعمدة closed_by_*)
    const { closed_by_id, closed_by_name, ...legacy } = row;
    return sbUpsert("shifts", row, "id", legacy);
  },

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
/* mapOrder -> rows.js */
const mapMenu = m => ({
  ...m,
  nameEn:       m.name_en      ?? m.nameEn      ?? "",
  minStock:     m.min_stock    ?? m.minStock     ?? 5,
  totalSold:    m.total_sold   ?? m.totalSold    ?? 0,
  outdoorPrice: m.outdoor_price ?? m.outdoorPrice ?? null,
  image:        m.image_url    ?? m.image       ?? "",
  imageIcon:    m.image_icon   ?? m.imageIcon   ?? "",
  cost:         m.cost         ?? 0,
  trackStock:   (m.track_stock ?? m.trackStock) !== false, // v28: مخزون مرن — غير معرّف = حقيقي
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
/* mapExpense -> rows.js */
// v25: تعقيم نصوص الطاولة — يزيل المحارف الفاسدة (U+FFFD وأشباهها) ويقصّ الطول.
// حماية دائمة: حتى لو تلفت البيانات في القاعدة مستقبلاً، لا تصل للواجهة أبداً.
const sanitizeTableText = (v, max) => {
  let s = String(v ?? "");
  s = s.replace(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); // محارف بديلة/تحكم
  if (s.length > max) s = s.slice(0, max);
  return s.trim();
};
const mapTable = t => ({
  id:       t.id,
  number:   t.number || +t.num || 0,
  num:      String(t.num || t.number || ""),
  label:    sanitizeTableText(t.label, 40) || `طاولة ${t.num || t.number}`,
  seats:    t.seats || 4,
  status:   t.status || "free",
  note:     sanitizeTableText(t.note, 200),
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
  date:         c.created_at    ?? c.createdAt    ?? c.at ?? c.date ?? new Date().toISOString(), // v28: توحيد حقل التاريخ مع شاشات العرض
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
  closedById:    s.closed_by_id   ?? s.closedById   ?? null, // v44
  closedByName:  s.closed_by_name ?? s.closedByName ?? "",   // v44
  notes:         s.notes         ?? "",
  shiftType:     s.shift_type    ?? s.shiftType    ?? "", // v31.6
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
  const [users,         setUsersRaw]        = useState(DEFAULT_USERS_PLAIN);
  const [menu,          setMenuRaw]          = useState(DEFAULT_MENU);
  const [orders,        setOrdersRaw]        = useState([]);
  const [notifications, setNotificationsRaw] = useState([]);
  const [cashLog,       setCashLogRaw]       = useState([]);
  const [tables,        setTablesRaw]        = useState(() => buildDefaultTables(20));
  const [outdoorTables, setOutdoorTablesRaw] = useState(() => buildOutdoorTables(10));
  const [debts,         setDebtsRaw]         = useState([]);
  const [expenses,      setExpensesRaw]      = useState([]);
  const [receipts,      setReceiptsRaw]      = useState([]);
  const [settings,      setSettingsRaw]      = useState({ ...DEFAULT_SETTINGS });
  const [compLog,       setCompLogRaw]       = useState([]);
  const [customers,     setCustomersRaw]     = useState([]);
  const [permOverrides, setPermOverridesRaw] = useState({});
  const [shifts,        setShiftsRaw]        = useState([]);
  const [loyaltyLog,    setLoyaltyLogRaw]    = useState([]);
  const [supplies,      setSuppliesRaw]      = useState([]);   // v42
  const [stockMoves,    setStockMovesRaw]    = useState([]);   // v42
  // v42: مراجع حيّة — تُقرأ داخل الدوال اللاتزامنية دون إعادة إنشائها
  const menuRef     = useRef([]);
  const suppliesRef = useRef([]);
  const [syncing,       setSyncing]          = useState(false);
  const [cloudReady,    setCloudReady]       = useState(false);

  // ── Setters ───────────────────────────────────────────────

  const setUsers = useCallback((v) => {
    setUsersRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      broadcast("nc_users", next);
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
      broadcast("nc_menu", next);
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
      // ══════════════════════════════════════════════════════════════
      // v41 — إصلاح جذري: كشف التغيير على الصف المُسلسَل كاملاً
      // ──────────────────────────────────────────────────────────────
      // كان الكشف يقارن قائمة حقول مكتوبة يدوياً (status/total/paymentType/
      // discount/tronAmount/items) ويُسقط كل ما عداها. النتيجة: أي تعديل يمسّ
      // حقلاً خارج القائمة لا يُرسَل إلى Supabase إطلاقاً — يظهر محلياً ويختفي
      // بعد التحديث. أصاب ذلك: table (نقل الطاولات) و notes و customerName و
      // workerName و shiftId و compAmount و isComplimentary و partialPaid و
      // paidAt و stockDeducted و originalTotal.
      // الآن نقارن ناتج rowOfOrder نفسه (بلا updated_at لأنه يُولَّد لحظياً)،
      // فيستحيل أن يُنسى عمود جديد مستقبلاً.
      // ══════════════════════════════════════════════════════════════
      const sigOf = (o) => {
        if (!o) return null;
        const { updated_at, ...r } = rowOfOrder(o);
        return JSON.stringify(r);
      };
      const oldSig = new Map();
      p.forEach(o => oldSig.set(o.id, sigOf(o)));
      const isChangedOrder = (o) => {
        if (!oldSig.has(o.id)) return true;
        return oldSig.get(o.id) !== sigOf(o);
      };

      // وسم updatedAt على الطلبات المتغيّرة → حلّ التعارض بالطابع الزمني (mesh/محلي).
      const next = raw.map(o => isChangedOrder(o) ? { ...o, updatedAt: new Date().toISOString() } : o);
      broadcast("nc_orders", next);
      if (SUPABASE_READY) {
        const changed = next.filter(isChangedOrder);
        // v4.7.0: عبر الطابور الدائم — يضمن إعادة المحاولة ولا يُفقد التغيير عند الفشل
        changed.forEach(o => {
          const row = rowOfOrder(o);
          const { stock_deducted, updated_at, tron_shift_id, ...legacy } = row; // fallback لقاعدة لم تُرقَّ
          enqueueWrite("orders", row, "id", legacy);
        });
        const nextIds = new Set(next.map(o => o.id));
        p.filter(o => !nextIds.has(o.id)).forEach(o => enqueueDelete("orders", o.id));
        if (changed.length || next.length !== p.length) flushOutbox();
      }
      return next;
    });
  }, []);

  const setNotifications = useCallback((v) => {
    setNotificationsRaw(p => {
      const d = typeof v === "function" ? v(p) : v;
      broadcast("nc_notifs", d); return d;
    });
  }, []);

  // ✅ cash_log يُرفع لـ Supabase
  const setCashLog = useCallback((v) => {
    setCashLogRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      broadcast("nc_cash", next);
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
      broadcast("nc_tables", next);
      if (SUPABASE_READY) {
        next.forEach(t => {
          const old = p.find(x => x.id === t.id);
          // v41: مقارنة كاملة — كانت تُسقط label/seats/number/openedAt فلا تُزامَن
          if (!old || JSON.stringify(old) !== JSON.stringify(t)) sbWrite.table(t);
        });
      }
      return next;
    });
  }, []);

  const setDebts = useCallback((v) => {
    setDebtsRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      broadcast("nc_debts", next);
      if (SUPABASE_READY) {
        next.forEach(d => {
          const old = p.find(x => x.id === d.id);
          // v41: مقارنة كاملة — كانت تُسقط amount/customerName/notes/settledAt،
          // فتعديل مبلغ دين أو اسم صاحبه لا يصل القاعدة إطلاقاً (خطأ مالي صامت).
          if (!old || JSON.stringify(old) !== JSON.stringify(d)) sbWrite.debt(d);
        });
      }
      return next;
    });
  }, []);

  const setExpenses = useCallback((v) => {
    setExpensesRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      broadcast("nc_expenses", next);
      if (SUPABASE_READY) {
        const prevIds = new Set(p.map(e => e.id));
        const added = next.filter(e => !prevIds.has(e.id));
        // v33.1: عبر الطابور الدائم + fallback => المصروف لا يُفقد عند فشل/انقطاع ولا تمحوه المزامنة
        added.forEach(e => enqueueWrite("expenses", rowOfExpense(e), "id", rowOfExpenseLegacy(e)));
        const nextIds = new Set(next.map(e => e.id));
        p.filter(e => !nextIds.has(e.id)).forEach(e => enqueueDelete("expenses", e.id));
        if (added.length) flushOutbox();
      }
      return next;
    });
  }, []);

  // ✅ receipts تُرفع لـ Supabase
  const setReceipts = useCallback((v) => {
    setReceiptsRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      broadcast("nc_receipts", next);
      if (SUPABASE_READY) {
        const prevIds = new Set(p.map(r => r.id));
        next.filter(r => !prevIds.has(r.id)).forEach(r => sbWrite.receipt(r));
      }
      return next;
    });
  }, []);

  const setSettings = useCallback((v) => {
    setSettingsRaw(p => {
      const raw = typeof v === "function" ? v(p) : v;
      // نضيف طابع زمني عند كل حفظ — يُستخدم للتحكيم مع السحابة
      const d = { ...raw, _savedAt: new Date().toISOString() };
      broadcast("nc_settings", d);
      if (SUPABASE_READY) sbSaveSettings(d);
      return d;
    });
  }, []);

  const setCompLog = useCallback((v) => {
    setCompLogRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      broadcast("nc_complog", next);
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
      broadcast("nc_customers", next);
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
      broadcast("nc_perms", next);
      if (SUPABASE_READY) sbSavePermOverrides(next);
      return next;
    });
  }, []);

  // v7: الورديات — تُرفع لـ Supabase
  const setShifts = useCallback((v) => {
    setShiftsRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      broadcast("nc_shifts", next);
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
      broadcast("nc_loyalty", next);
      if (SUPABASE_READY) {
        const prevIds = new Set(p.map(l => l.id));
        next.filter(l => !prevIds.has(l.id)).forEach(l => sbWrite.loyaltyLog(l));
      }
      return next;
    });
  }, []);

  // ══════════════════════════════════════════════════════════════
  // v42 — المواد الإضافية + سجل حركات المخزون
  // ──────────────────────────────────────────────────────────────
  // المبدأ: كل تغيّر في الرصيد يمرّ عبر adjustStock/adjustSupply، وهما
  // يرسلان **الفارق** إلى القاعدة (qty = qty + delta) لا القيمة المطلقة،
  // فيستحيل فقدان تحديث عند تزامن جهازين. وكل حركة تُسجَّل في
  // stock_movements داخل نفس المعاملة، فلا يتغيّر رصيد بلا أثر.
  // ══════════════════════════════════════════════════════════════
  const setSupplies = useCallback((v) => {
    setSuppliesRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      broadcast("nc_supplies", next);
      if (SUPABASE_READY) {
        next.forEach(sup => {
          const old = p.find(x => x.id === sup.id);
          if (!old || JSON.stringify(old) !== JSON.stringify(sup)) enqueueWrite("supplies", rowOfSupply(sup), "id");
        });
        const ids = new Set(next.map(x => x.id));
        p.forEach(sup => { if (!ids.has(sup.id)) enqueueDelete("supplies", sup.id); });
        flushOutbox();
      }
      return next;
    });
  }, []);

  // تسجيل حركة محلياً (تُستعمل عند الارتداد أو للتسجيل المحض بلا تعديل رصيد)
  const logStockMove = useCallback((move) => {
    const m = { ...move, id: move.id || newMoveId(), at: move.at || new Date().toISOString() };
    setStockMovesRaw(p => (p.some(x => x.id === m.id) ? p : [m, ...p].slice(0, 500)));
    if (SUPABASE_READY) { enqueueWrite("stock_movements", rowOfMovement(m), "id"); flushOutbox(); }
    return m;
  }, []);

  // تعديل مخزون صنف من المنيو بفارق نسبي — المسار الذرّي أولاً
  const adjustStock = useCallback(async (itemId, delta, meta = {}) => {
    const d = +delta || 0;
    if (!itemId || !d) return { ok: false, reason: "noop" };
    const moveId = meta.moveId || newMoveId();
    const item = menuRef.current.find(m => m.id === itemId);
    const move = {
      id: moveId, kind: "menu", itemId, itemName: item?.name || "",
      delta: d, qtyAfter: null, reason: meta.reason || "restock",
      orderId: meta.orderId || null, orderNum: meta.orderNum || "",
      userId: meta.userId || null, userName: meta.userName || "", userRole: meta.userRole || "",
      shiftId: meta.shiftId || null, branch: meta.branch || "main", note: meta.note || "",
      at: new Date().toISOString(),
    };

    if (SUPABASE_READY) {
      const res = await adjustStockAtomic({ id: itemId, delta: d, moveId, ...meta });
      if (res.ok) {
        // القاعدة أعادت الرصيد الحقيقي بعد التعديل — نعتمده مرجعاً
        setMenuRaw(p => { const n = p.map(m => m.id === itemId ? { ...m, stock: res.qtyAfter } : m); broadcast("nc_menu", n); return n; });
        setStockMovesRaw(p => (p.some(x => x.id === moveId) ? p : [{ ...move, qtyAfter: res.qtyAfter }, ...p].slice(0, 500)));
        return { ok: true, qtyAfter: res.qtyAfter, atomic: true };
      }
      // لا RPC (قبل هجرة v42) أو انقطاع — ارتداد محلي + طابور
    }
    let after = null;
    setMenuRaw(p => {
      const n = p.map(m => { if (m.id !== itemId) return m; after = Math.max(0, (+m.stock || 0) + d); return { ...m, stock: after }; });
      broadcast("nc_menu", n);
      if (SUPABASE_READY) { const m = n.find(x => x.id === itemId); if (m) enqueueWrite("menu_items", { id: m.id, stock: m.stock }, "id"); }
      return n;
    });
    logStockMove({ ...move, qtyAfter: after });
    if (SUPABASE_READY) flushOutbox();
    return { ok: true, qtyAfter: after, atomic: false };
  }, [logStockMove]);

  // تعديل مادة إضافية بفارق نسبي — المسار الذرّي أولاً
  const adjustSupply = useCallback(async (supplyId, delta, meta = {}) => {
    const d = +delta || 0;
    if (!supplyId || !d) return { ok: false, reason: "noop" };
    const moveId = meta.moveId || newMoveId();
    const sup = suppliesRef.current.find(x => x.id === supplyId);
    const move = {
      id: moveId, kind: "supply", itemId: supplyId, itemName: sup?.name || "",
      delta: d, qtyAfter: null, reason: meta.reason || "restock",
      userId: meta.userId || null, userName: meta.userName || "", userRole: meta.userRole || "",
      shiftId: meta.shiftId || null, branch: meta.branch || "main", note: meta.note || "",
      at: new Date().toISOString(),
    };

    if (SUPABASE_READY) {
      const res = await adjustSupplyAtomic({ id: supplyId, delta: d, moveId, ...meta });
      if (res.ok) {
        setSuppliesRaw(p => { const n = p.map(x => x.id === supplyId ? { ...x, qty: res.qtyAfter } : x); broadcast("nc_supplies", n); return n; });
        setStockMovesRaw(p => (p.some(x => x.id === moveId) ? p : [{ ...move, qtyAfter: res.qtyAfter }, ...p].slice(0, 500)));
        return { ok: true, qtyAfter: res.qtyAfter, atomic: true };
      }
    }
    let after = null;
    setSuppliesRaw(p => {
      const n = p.map(x => { if (x.id !== supplyId) return x; after = Math.max(0, (+x.qty || 0) + d); return { ...x, qty: after }; });
      broadcast("nc_supplies", n);
      if (SUPABASE_READY) { const x = n.find(y => y.id === supplyId); if (x) enqueueWrite("supplies", rowOfSupply(x), "id"); }
      return n;
    });
    logStockMove({ ...move, qtyAfter: after });
    if (SUPABASE_READY) flushOutbox();
    return { ok: true, qtyAfter: after, atomic: false };
  }, [logStockMove]);

  useEffect(() => { menuRef.current = menu; }, [menu]);
  useEffect(() => { suppliesRef.current = supplies; }, [supplies]);

  // v43: خصم/إرجاع مخزون طلب كامل — ذرّي في القاعدة ومُسجَّل في stock_movements.
  // كان البيع يخصم بكتابة قيمة مطلقة من المتصفح وخارج السجل تماماً، فلا
  // يمكن تدقيقه ولا يسلم من فقدان التحديث. sign = -1 خصم، +1 إرجاع.
  const applyOrderStock = useCallback(async (order, sign = -1, meta = {}) => {
    const items = (order?.items || []).map(i => ({ itemId: i.itemId, qty: +i.qty || 0 }));
    if (!items.length) return { ok: true, applied: 0 };
    // الأصناف الخدمية/مفتوحة المخزون لا تُخصم (نفس قاعدة القاعدة)
    const tracked = items.filter(i => {
      const m = menuRef.current.find(x => x.id === i.itemId);
      return m && !m.noStock && m.trackStock !== false;
    });
    if (!tracked.length) return { ok: true, applied: 0 };
    const reason = meta.reason || (sign < 0 ? "sale" : "return");

    if (SUPABASE_READY) {
      const res = await adjustStockBulkAtomic({
        items: tracked, sign, reason,
        orderId: order.id, orderNum: order.orderNum || "",
        userId: meta.userId || null, userName: meta.userName || "", userRole: meta.userRole || "",
        shiftId: meta.shiftId || order.shiftId || null, branch: meta.branch || order.branch || "main",
        key: meta.key || order.id,
      });
      if (res.ok) {
        // نطبّق محلياً للعرض الفوري (القاعدة هي المرجع وستصل عبر المزامنة)
        setMenuRaw(p => {
          const n = p.map(m => {
            const it = tracked.find(x => x.itemId === m.id);
            if (!it) return m;
            return { ...m, stock: Math.max(0, (+m.stock || 0) + sign * it.qty),
                     totalSold: Math.max(0, (+m.totalSold || 0) - sign * it.qty) };
          });
          broadcast("nc_menu", n); return n;
        });
        return { ok: true, applied: res.applied, atomic: true };
      }
    }

    // ارتداد محلي (قبل هجرة v43 أو دون اتصال) — مع تسجيل الحركات
    setMenuRaw(p => {
      const n = p.map(m => {
        const it = tracked.find(x => x.itemId === m.id);
        if (!it) return m;
        return { ...m, stock: Math.max(0, (+m.stock || 0) + sign * it.qty),
                 totalSold: Math.max(0, (+m.totalSold || 0) - sign * it.qty) };
      });
      broadcast("nc_menu", n);
      if (SUPABASE_READY) n.forEach(m => {
        if (tracked.some(x => x.itemId === m.id)) enqueueWrite("menu_items", { id: m.id, stock: m.stock, total_sold: m.totalSold }, "id");
      });
      return n;
    });
    tracked.forEach(it => {
      const m = menuRef.current.find(x => x.id === it.itemId);
      logStockMove({
        id: `mv_${meta.key || order.id}_${it.itemId}_${reason}`, // حتمي ⇒ لا تكرار
        kind: "menu", itemId: it.itemId, itemName: m?.name || "",
        delta: sign * it.qty, qtyAfter: null, reason,
        orderId: order.id, orderNum: order.orderNum || "",
        userId: meta.userId || null, userName: meta.userName || "", userRole: meta.userRole || "",
        shiftId: meta.shiftId || order.shiftId || null, branch: meta.branch || order.branch || "main",
      });
    });
    if (SUPABASE_READY) flushOutbox();
    return { ok: true, atomic: false };
  }, [logStockMove]);

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
      broadcast("nc_tables", next);
      if (SUPABASE_READY) sbWrite.table(newTable);
      return next;
    });
  }, []);

  // ══════════════════════════════════════════════════════════
  // v25: إعادة ضبط الطاولات بالكامل — حذف كل صفوف tables من السحابة
  // ثم توليد طاولات نظيفة ورفعها. يحل تلف بيانات الطاولات جذرياً.
  // ══════════════════════════════════════════════════════════
  const resetTables = useCallback(async (branch = "main", count = 20) => {
    const fresh = branch === "outdoor" ? buildOutdoorTables(count) : buildDefaultTables(count);
    if (SUPABASE_READY && supabase) {
      // حذف طاولات هذا الفرع فقط من السحابة
      const q = supabase.from("tables").delete();
      // v25.1: الصالة تشمل الصفوف القديمة ذات branch فارغ (null) حتى لا تعود عبر Realtime
      const { error: delErr } = branch === "main"
        ? await q.or("branch.eq.main,branch.is.null")
        : await q.eq("branch", branch);
      if (delErr) throw new Error("فشل حذف الطاولات: " + delErr.message);
      // رفع الطاولات النظيفة دفعة واحدة
      const rows = fresh.map(t => ({
        id: t.id, number: t.number, num: t.num, label: t.label,
        seats: t.seats, status: t.status, note: t.note,
        order_id: null, opened_at: null, branch: t.branch,
      }));
      const { error: insErr } = await supabase.from("tables").upsert(rows, { onConflict: "id" });
      if (insErr) throw new Error("فشل إنشاء الطاولات: " + insErr.message);
    }
    if (branch === "outdoor") {
      setOutdoorTablesRaw(fresh); broadcast("nc_outdoor_tables", fresh);
    } else {
      setTablesRaw(fresh); broadcast("nc_tables", fresh);
    }
    return fresh.length;
  }, []);

  const setOutdoorTables = useCallback((v) => {
    setOutdoorTablesRaw(p => {
      const next = typeof v === "function" ? v(p) : v;
      broadcast("nc_outdoor_tables", next);
      if (SUPABASE_READY) {
        next.forEach(t => {
          const old = p.find(x => x.id === t.id);
          // v41: مقارنة كاملة — كانت تُسقط label/seats/number/openedAt فلا تُزامَن
          if (!old || JSON.stringify(old) !== JSON.stringify(t)) sbWrite.table(t);
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
      broadcast("nc_outdoor_tables", next);
      if (SUPABASE_READY) sbWrite.table(newTable);
      return next;
    });
  }, []);

  // ══════════════════════════════════════════════════════════
  // v22: دفع ذرّي أونلاين — السحابة أولاً (RPC أو fallback)، وعند النجاح
  // فقط تُحدَّث الحالة المحلية. أي فشل/مهلة يُرمى للواجهة لعرضه للمستخدم.
  // ══════════════════════════════════════════════════════════
  const payOrder = useCallback(async (paidOrder, cashEntry, { freeTable = false } = {}) => {
    // v32: الدفع محليًا أولًا — فوري وidempotent، فلا تُفقد الفاتورة/النقد أبدًا عند انقطاع الشبكة.
    const stamped = { ...paidOrder, updatedAt: new Date().toISOString() };
    setOrdersRaw(p => { const n = p.map(o => o.id === paidOrder.id ? stamped : o); broadcast("nc_orders", n); return n; });
    setCashLogRaw(p => p.some(c => c.id === cashEntry.id) ? p : (() => { const n = [cashEntry, ...p]; broadcast("nc_cash", n); return n; })());
    if (!SUPABASE_READY) return { cloud: false };

    const enqueuePay = () => {
      const row = rowOfOrder(stamped);
      const { stock_deducted, updated_at, tron_shift_id, ...legacy } = row; // fallback لقاعدة لم تُرقَّ
      enqueueWrite("orders", row, "id", legacy);
      enqueueWrite("cash_log", rowOfCash(cashEntry));
      flushOutbox();
    };

    // دون اتصال: لا ننتظر مهلة 10ث — نُدرج مباشرةً في الطابور
    if (typeof navigator !== "undefined" && navigator.onLine === false) { enqueuePay(); return { cloud: false }; }

    try {
      await payOrderAtomic({
        orderRow: rowOfOrder(stamped),
        cashRow: rowOfCash(cashEntry),
        freeTable,
        tableNum: paidOrder.table,
        branch: paidOrder.branch || "main",
      });
      return { cloud: true };
    } catch (e) {
      // فشل/مهلة السحابة — الدفع محفوظ محليًا، نُدرج للمزامنة لاحقًا (idempotent، لا دفع مزدوج)
      enqueuePay();
      return { cloud: false };
    }
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
        case "nc_supplies":       setSuppliesRaw(data);      break;   // v42
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

  // ══════════════════════════════════════════════════════════
  // تحميل من Supabase عند الفتح
  // ══════════════════════════════════════════════════════════
  // fix(sync): Promise.allSettled بدل Promise.all — كل جدول مستقل
  // fix(sync): timeout 12s لكل طلب — لا تجمّد في شبكة بطيئة
  // fix(sync): flushOutbox فور اكتمال التحميل — لا انتظار لـ online event
  const pullAll = useCallback(() => {
    if (!SUPABASE_READY) return Promise.resolve();
    setSyncing(true);

    // timeout wrapper: يرفع خطأ بعد 12 ثانية إن لم يستجب الجدول
    const withTimeout = (promise, label) =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`timeout: ${label}`)), 12000)
        ),
      ]).catch(err => {
        console.warn(`[sync] ${label} فشل:`, err.message);
        return { data: null, error: err }; // يُعامَل كنتيجة فارغة آمنة
      });

    return Promise.allSettled([
      withTimeout(supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(500), "orders"),
      withTimeout(supabase.from("menu_items").select("*").order("category"), "menu_items"),
      withTimeout(supabase.from("profiles").select("*"), "profiles"),
      withTimeout(supabase.from("debts").select("*").order("date", { ascending: false }), "debts"),
      withTimeout(supabase.from("expenses").select("*").order("date", { ascending: false }), "expenses"),
      withTimeout(supabase.from("cash_log").select("*").order("at", { ascending: false }).limit(200), "cash_log"),
      withTimeout(supabase.from("tables").select("*").eq("branch","main").order("number"), "tables_main"),
      withTimeout(supabase.from("tables").select("*").eq("branch","outdoor").order("number"), "tables_outdoor"),
      withTimeout(supabase.from("receipts").select("*").order("created_at", { ascending: false }).limit(200), "receipts"),
      withTimeout(supabase.from("comp_log").select("*").order("created_at", { ascending: false }).limit(200), "comp_log"),
      withTimeout(supabase.from("customers").select("*").order("created_at", { ascending: false }), "customers"),
      withTimeout(supabase.from("app_settings").select("*").eq("id", "main").single(), "app_settings"),
      withTimeout(supabase.from("perm_overrides").select("*").eq("id", "main").single(), "perm_overrides"),
      withTimeout(supabase.from("shifts").select("*").order("opened_at", { ascending: false }).limit(200), "shifts"),
      withTimeout(supabase.from("loyalty_log").select("*").order("created_at", { ascending: false }).limit(300), "loyalty_log"),
      withTimeout(supabase.from("supplies").select("*").order("name"), "supplies"),                                        // v42
      withTimeout(supabase.from("stock_movements").select("*").order("at", { ascending: false }).limit(400), "stock_movements"), // v42
    ]).then((results) => {
      // allSettled: كل نتيجة إما { status:"fulfilled", value } أو { status:"rejected", reason }
      // withTimeout يُحوّل الأخطاء لـ { data: null } — لذا كلها fulfilled هنا
      const [ord, men, prof, dbt, exp, cash, tbl, outdoorTbl, rct, cmp, cust, sett, perms, shf, loy, sup, smv] =
        results.map(r => r.status === "fulfilled" ? r.value : { data: null, error: r.reason });

      if (ord.data)  {
        const d = ord.data.map(mapOrder);
        // v4.7.0: لا تكتب فوق طلب لم تُرفَع تعديلاته بعد (طابور) أو تعديله المحلي أحدث
        setOrdersRaw(prev => {
          const pending = outboxPendingIds("orders");
          const prevById = new Map(prev.map(o => [o.id, o]));
          const merged = d.map(row => {
            const local = prevById.get(row.id);
            if (!local) return row;
            if (pending.has(row.id)) return local; // تغيير محلي لم يُرفع — أبقِه
            // v33: الحالة النهائية من الخادم مرجعية؛ غير النهائية: المحلي الأحدث يفوز
            const TERM = ["paid", "debt", "complimentary", "cancelled"];
            if (!TERM.includes(row.status) && local.updatedAt && row.updatedAt && Date.parse(local.updatedAt) > Date.parse(row.updatedAt)) return local;
            return row;
          });
          // طلبات محلية معلّقة غير موجودة في السحابة بعد — لا تحذفها
          const cloudIds = new Set(d.map(o => o.id));
          prev.forEach(o => { if (!cloudIds.has(o.id) && pending.has(o.id)) merged.push(o); });
          return merged;
        });
      }
      if (men.data?.length)  { const d = men.data.map(mapMenu);     setMenuRaw(d);     }
      if (prof.data?.length) { setUsersRaw(prof.data);               }
      else { getHashedDefaultUsers().then(hu => hu.forEach(u => sbWrite.user(u))); }
      if (dbt.data)  { const d = dbt.data.map(mapDebt);     setDebtsRaw(d);    }
      if (exp.data)  {
        const d = exp.data.map(mapExpense);
        // v33.1: لا تمحُ مصروفًا محليًا لم يُرفع بعد (طابور)
        setExpensesRaw(prev => {
          const pend = outboxPendingIds("expenses");
          if (!pend.size) return d;
          const cloudIds = new Set(d.map(e => e.id));
          const keepLocal = prev.filter(e => pend.has(e.id) && !cloudIds.has(e.id));
          return [...keepLocal, ...d];
        });
      }
      if (cash.data) { const d = cash.data.map(mapCash);    setCashLogRaw(d);  }
      if (rct.data)  { const d = rct.data.map(mapReceipt);  setReceiptsRaw(d); }
      if (tbl.data?.length)  { const d = tbl.data.map(mapTable);    setTablesRaw(d);   }
      if (outdoorTbl.data?.length) {
        const d = outdoorTbl.data.map(mapTable);
        setOutdoorTablesRaw(d); }
      if (cmp.data)  { const d = cmp.data.map(mapCompLog);  setCompLogRaw(d);  }
      if (cust.data) { const d = cust.data.map(mapCustomer);setCustomersRaw(d);}
      // ══ v22: الإعدادات من السحابة دائماً — وإن كانت فارغة نبذر الافتراضية ══
      {
        const cloudData = sett.data?.data || {};
        if (Object.keys(cloudData).length > 0) {
          setSettingsRaw({ ...DEFAULT_SETTINGS, ...cloudData });
        } else if (sett.data != null || /no rows|PGRST116/i.test(String(sett.error?.message || ""))) {
          const stamped = { ...DEFAULT_SETTINGS, _savedAt: new Date().toISOString() };
          setSettingsRaw(stamped);
          sbSaveSettings(stamped);
        }
      }
      if (perms.data?.data)  { setPermOverridesRaw(perms.data.data); }
      if (shf?.data?.length) { const d = shf.data.map(mapShift);   setShiftsRaw(d);   }
      if (loy?.data?.length) { const d = loy.data.map(mapLoyalty); setLoyaltyLogRaw(d);}

      // ══ v42: المواد الإضافية + سجل الحركات ══
      if (smv?.data) { setStockMovesRaw(smv.data.map(mapMovement)); }
      if (sup?.data) {
        const cloud = sup.data.map(mapSupply);
        if (cloud.length) {
          setSuppliesRaw(cloud);
        } else {
          // ترحيل لمرة واحدة: الجدول فارغ والحقل القديم عامر ⇒ ننقله ونرفعه.
          // settings.extraStock يبقى كما هو (نسخة احتياطية قابلة للمراجعة).
          const legacy = migrateExtraStock(sett.data?.data?.extraStock);
          if (legacy.length) {
            setSuppliesRaw(legacy);
            legacy.forEach(x => enqueueWrite("supplies", rowOfSupply(x), "id"));
            flushOutbox();
          } else {
            setSuppliesRaw([]);
          }
        }
      }

      setCloudReady(true);
    }).finally(() => { setSyncing(false); flushOutbox(); }); // v4.7.0: فرّغ الطابور بعد السحب
  }, []);

  useEffect(() => { pullAll(); }, [pullAll]);

  // fix(offline-sync): إعادة السحب الكامل عند عودة الاتصال أو الرجوع للتطبيق.
  // عند انقطاع الإنترنت يفوت الجهازَ تغييراتُ الأجهزة الأخرى (Realtime لا يعوّض
  // الأحداث الفائتة)، لذا ندفع الطابور المؤجّل أولًا ثم نسحب أحدث البيانات.
  const lastPullRef = useRef(0);
  useEffect(() => {
    if (!SUPABASE_READY) return;
    const onReconnect = async () => {
      lastPullRef.current = Date.now();
      await flushOutbox(); // v4.7.0: ادفع المؤجّل أولًا
      await pullAll();
    };
    const onVis = () => {
      if (document.visibilityState === "visible" && navigator.onLine && Date.now() - lastPullRef.current > 10000) onReconnect();
    };
    window.addEventListener("online", onReconnect);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("online", onReconnect);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pullAll]);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    // v4.7.0: تجاهل الحدث إن كان الطلب معلّقًا في الطابور أو نسخته المحلية أحدث
    const applyRemote = (m) => setOrdersRaw(p => {
      const local = p.find(o => o.id === m.id);
      if (local) {
        if (outboxPendingIds("orders").has(m.id)) return p; // محلي لم يُرفع
        // v33: الحالة النهائية من الخادم مرجعية (تقارب الأجهزة)؛ غير النهائية: الأحدث يفوز
        const TERM = ["paid", "debt", "complimentary", "cancelled"];
        if (!TERM.includes(m.status) && local.updatedAt && m.updatedAt && Date.parse(local.updatedAt) > Date.parse(m.updatedAt)) return p;
        // v44: صدى Realtime لتغييرٍ نحن مصدره — لا شيء تغيّر فعلاً.
        // كان يُعيد مصفوفة جديدة دائماً، فيُرندَر التطبيق كله بلا سبب مع
        // كل كتابة (وأثناء نافذة التعديل: وميض وإعادة بناء). المقارنة
        // البنيوية تُسكت هذا الصدى وتُبقي المرجع كما هو.
        if (JSON.stringify(local) === JSON.stringify(m)) return p;
      }
      const n = [m, ...p.filter(o => o.id !== m.id)];
      broadcast("nc_orders", n); return n;
    });
    return subscribeOrders(
      (r) => applyRemote(mapOrder(r)),
      (r) => applyRemote(mapOrder(r)),
      (r) => setOrdersRaw(p => { const n = p.filter(o => o.id !== r.id); broadcast("nc_orders", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeTables((newRow, deletedId) => {
      if (deletedId) {
        setTablesRaw(p => { const n = p.filter(t => t.id !== deletedId); broadcast("nc_tables", n); return n; });
        setOutdoorTablesRaw(p => { const n = p.filter(t => t.id !== deletedId); broadcast("nc_outdoor_tables", n); return n; });
      } else if (newRow) {
        const t = mapTable(newRow);
        if (t.branch === "outdoor") {
          setOutdoorTablesRaw(p => { const n = [t, ...p.filter(x => x.id !== t.id)].sort((a,b)=>a.number-b.number); broadcast("nc_outdoor_tables", n); return n; });
        } else {
          setTablesRaw(p => { const n = [t, ...p.filter(x => x.id !== t.id)].sort((a,b)=>a.number-b.number); broadcast("nc_tables", n); return n; });
        }
      }
    });
  }, []);

  // v42: مزامنة حيّة للمواد وسجل الحركات
  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeSupplies((newRow, deletedId) => {
      if (deletedId) setSuppliesRaw(p => { const n = p.filter(x => x.id !== deletedId); broadcast("nc_supplies", n); return n; });
      else if (newRow) {
        const sup = mapSupply(newRow);
        setSuppliesRaw(p => { const n = [sup, ...p.filter(x => x.id !== sup.id)].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar")); broadcast("nc_supplies", n); return n; });
      }
    });
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeStockMovements((r) => {
      const m = mapMovement(r);
      setStockMovesRaw(p => (p.some(x => x.id === m.id) ? p : [m, ...p].slice(0, 500)));
    });
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeDebts(
      (r) => setDebtsRaw(p => { const d = mapDebt(r); const n = [d, ...p.filter(x => x.id !== d.id)]; broadcast("nc_debts", n); return n; }),
      (r) => setDebtsRaw(p => { const d = mapDebt(r); const n = p.map(x => x.id === d.id ? d : x);   broadcast("nc_debts", n); return n; }),
      (r) => setDebtsRaw(p => { const n = p.filter(x => x.id !== r.id);                               broadcast("nc_debts", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY || !supabase) return;
    const ch = supabase.channel("profiles-rt-v6")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (p) => {
        if (p.eventType === "INSERT" || p.eventType === "UPDATE") {
          setUsersRaw(prev => { const n = [p.new, ...prev.filter(u => u.id !== p.new.id)]; broadcast("nc_users", n); return n; });
        }
        if (p.eventType === "DELETE") {
          setUsersRaw(prev => { const n = prev.filter(u => u.id !== p.old.id); broadcast("nc_users", n); return n; });
        }
      }).subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeMenu(
      (r) => setMenuRaw(p => { const m = mapMenu(r); const n = [m, ...p.filter(x => x.id !== m.id)]; broadcast("nc_menu", n); return n; }),
      (r) => setMenuRaw(p => { const m = mapMenu(r); const n = p.map(x => x.id === m.id ? m : x);   broadcast("nc_menu", n); return n; }),
      (r) => setMenuRaw(p => { const n = p.filter(x => x.id !== r.id);                               broadcast("nc_menu", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeExpenses(
      (r) => setExpensesRaw(p => { const e = mapExpense(r); const n = [e, ...p.filter(x => x.id !== e.id)]; broadcast("nc_expenses", n); return n; }),
      (r) => setExpensesRaw(p => { const e = mapExpense(r); const n = p.map(x => x.id === e.id ? e : x);   broadcast("nc_expenses", n); return n; }),
      (r) => setExpensesRaw(p => { const n = p.filter(x => x.id !== r.id);                                  broadcast("nc_expenses", n); return n; }),
    );
  }, []);

  // ✅ subscribeReceipts مربوط بـ store
  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeReceipts(
      (r) => setReceiptsRaw(p => { const m = mapReceipt(r); const n = [m, ...p.filter(x => x.id !== m.id)]; broadcast("nc_receipts", n); return n; }),
      (r) => setReceiptsRaw(p => { const m = mapReceipt(r); const n = p.map(x => x.id === m.id ? m : x);   broadcast("nc_receipts", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeCompLog(
      (r) => setCompLogRaw(p => { const c = mapCompLog(r); const n = [c, ...p.filter(x => x.id !== c.id)]; broadcast("nc_complog", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeCustomers(
      (r) => setCustomersRaw(p => { const c = mapCustomer(r); const n = [c, ...p.filter(x => x.id !== c.id)]; broadcast("nc_customers", n); return n; }),
      (r) => setCustomersRaw(p => { const c = mapCustomer(r); const n = p.map(x => x.id === c.id ? c : x);   broadcast("nc_customers", n); return n; }),
      (r) => setCustomersRaw(p => { const n = p.filter(x => x.id !== r.id);                                   broadcast("nc_customers", n); return n; }),
    );
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeSettings((row) => {
      if (row?.data) {
        const n = { ...DEFAULT_SETTINGS, ...row.data };
        setSettingsRaw(n); broadcast("nc_settings", n);
      }
    });
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribePermOverrides((row) => {
      if (row?.data) {
        setPermOverridesRaw(() => { broadcast("nc_perms", row.data); return row.data; });
      }
    });
  }, []);

  // v7: subscription لسجل النقد (مهم لتقفيل الوردية عبر الأجهزة)
  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeCashLog(
      (r) => setCashLogRaw(p => { const c = mapCash(r); const n = [c, ...p.filter(x => x.id !== c.id)]; broadcast("nc_cash", n); return n; }),
      (r) => setCashLogRaw(p => { const n = p.filter(x => x.id !== r.id); broadcast("nc_cash", n); return n; }),
    );
  }, []);

  // v7: subscriptions للورديات
  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeShifts(
      (r) => setShiftsRaw(p => { const s = mapShift(r); const n = [s, ...p.filter(x => x.id !== s.id)]; broadcast("nc_shifts", n); return n; }),
      (r) => setShiftsRaw(p => { const s = mapShift(r); const n = p.map(x => x.id === s.id ? s : x);   broadcast("nc_shifts", n); return n; }),
      (r) => setShiftsRaw(p => { const n = p.filter(x => x.id !== r.id);                                broadcast("nc_shifts", n); return n; }),
    );
  }, []);

  // v7: subscription لسجل الولاء
  useEffect(() => {
    if (!SUPABASE_READY) return;
    return subscribeLoyaltyLog(
      (r) => setLoyaltyLogRaw(p => { const l = mapLoyalty(r); const n = [l, ...p.filter(x => x.id !== l.id)]; broadcast("nc_loyalty", n); return n; }),
    );
  }, []);

  return {
    users, setUsers,
    menu, setMenu,
    orders, setOrders,
    notifications, setNotifications,
    cashLog, setCashLog,
    tables, setTables, addTable, resetTables,
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
    supplies, setSupplies,                       // v42
    stockMoves, logStockMove,                    // v42
    adjustStock, adjustSupply,                   // v42: تعديل ذرّي بفارق نسبي
    applyOrderStock,                             // v43: خصم/إرجاع مخزون الطلب ذرّياً ومُسجَّلاً
    payOrder,
    syncing, cloudReady,
  };
};
