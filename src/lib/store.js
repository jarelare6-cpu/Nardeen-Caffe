// src/lib/store.js — Nardeen Caffe — Full Cross-Device Sync
import { useState, useCallback, useEffect } from "react";
import { supabase, SUPABASE_READY, subscribeOrders } from "./supabase";
const ls = {
get: (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("nardeen_sync") : null;
const broadcast = (key, data) => { if (bc) bc.postMessage({ key, data, ts: Date.now() }); };
// ══════════════════════════════════════════════════════════════
// كتابة إلى Supabase — كل البيانات
// ══════════════════════════════════════════════════════════════
const sbWrite = {
// ── الموظفين ─────────────────────────────────────────────
user: async (u) => {
if (!SUPABASE_READY) return;
await supabase.from("profiles").upsert({
id: u.id, username: u.username, password: u.password,
role: u.role, name: u.name, email: u.email || "",
active: u.active, shift: u.shift || null,
}, { onConflict: "id" });
},
deleteUser: async (id) => {
if (!SUPABASE_READY) return;
await supabase.from("profiles").delete().eq("id", id);
},
// ── المنيو ───────────────────────────────────────────────
menuItem: async (m) => {
if (!SUPABASE_READY) return;
await supabase.from("menu_items").upsert({
id: m.id, name: m.name, name_en: m.nameEn || "",
price: m.price, category: m.category,
stock: m.stock, min_stock: m.minStock || 5,
total_sold: m.totalSold || 0, emoji: m.emoji || "",
active: m.active !== false,
}, { onConflict: "id" });
},
deleteMenuItem: async (id) => {
if (!SUPABASE_READY) return;
await supabase.from("menu_items").delete().eq("id", id);
},
// ── الطلبات ──────────────────────────────────────────────
order: async (o) => {
if (!SUPABASE_READY) return;
await supabase.from("orders").upsert({
id: o.id, order_num: o.orderNum,
customer_name: o.customerName, customer_id: o.customerId,
table_num: o.table, items: o.items,
total: o.total, discount: o.discount || 0,
status: o.status, payment_type: o.paymentType,
notes: o.notes, created_at: o.createdAt,
paid_at: o.paidAt || null, paid_by: o.paidBy || null,
is_debt_settlement: o.isDebtSettlement || false,
}, { onConflict: "id" });
},
// ── الديون ───────────────────────────────────────────────
debt: async (d) => {
if (!SUPABASE_READY) return;
await supabase.from("debts").upsert({
id: d.id, customer_name: d.customerName,
amount: d.amount, remaining: d.remaining,
settled: d.settled, settled_at: d.settledAt || null,
date: d.date, notes: d.notes || "",
created_by: d.createdBy || "", order_id: d.orderId || null,
}, { onConflict: "id" });
},
// ── المصاريف ─────────────────────────────────────────────
expense: async (e) => {
if (!SUPABASE_READY) return;
await supabase.from("expenses").upsert({
id: e.id, label: e.label, amount: e.amount,
date: e.date, by: e.by || "", notes: e.notes || "",
}, { onConflict: "id" });
},
// ── سجل الكاش ────────────────────────────────────────────
cashLog: async (e) => {
if (!SUPABASE_READY) return;
await supabase.from("cash_log").upsert({
id: e.id, order_id: e.orderId || null,
order_num: e.orderNum || "", amount: e.amount,
at: e.at, by: e.by || "", type: e.type || "sale",
}, { onConflict: "id" });
},
};
// ══════════════════════════════════════════════════════════════
export const DEFAULT_SETTINGS = {
cafeName: "Nardeen Caffe",
signature: "بإدارة يحيى داؤود",
currency: "ل.س",
maxDiscount: 50,
workerCanDecreaseStock: false,
cashierCanSeeReports: true,
allowCustomerOrders: true,
taxPercent: 0,
appLang: "ar",
};
export const DEFAULT_USERS = [
{ id:"u1", username:"admin", password:"admin1", role:"admin", name:"يحيى داؤود", email:"admin@nardeen.cafe", active:true, shift:null },
{ id:"u2", username:"cashier_am", password:"Cash@AM24", role:"cashier", name:"كاشير الصباح", email:"cashier.am@nardeen.cafe", active:true, shift:"صباحي" },
{ id:"u3", username:"cashier_pm", password:"Cash@PM24", role:"cashier", name:"كاشير المساء", email:"cashier.pm@nardeen.cafe", active:true, shift:"مسائي" },
{ id:"u4", username:"bar1", password:"Bar@AM24", role:"bar", name:"بار الصباح", email:"bar1@nardeen.cafe", active:true, shift:"صباحي" },
{ id:"u5", username:"bar2", password:"Bar@PM24", role:"bar", name:"بار المساء", email:"bar2@nardeen.cafe", active:true, shift:"مسائي" },
{ id:"u6", username:"hookah1", password:"Hook@AM24", role:"hookah", name:"أراكيل الصباح", email:"hookah1@nardeen.cafe", active:true, shift:"صباحي" },
{ id:"u7", username:"hookah2", password:"Hook@PM24", role:"hookah", name:"أراكيل المساء", email:"hookah2@nardeen.cafe", active:true, shift:"مسائي" },
{ id:"u8", username:"worker1", password:"Work@AM24", role:"worker", name:"عامل الصباح", email:"worker1@nardeen.cafe", active:true, shift:"صباحي" },
{ id:"u9", username:"worker2", password:"Work@PM24", role:"worker", name:"عامل المساء", email:"worker2@nardeen.cafe", active:true, shift:"مسائي" },
];
export const DEFAULT_MENU = [
{ id:"m1", name:"قهوة عربية", nameEn:"Arabic Coffee", price:2500, category:"hot_drinks", stock:100, minStock:10, totalSold:0, emoji:"☕" },
{ id:"m2", name:"شاي", nameEn:"Tea", price:1500, category:"hot_drinks", stock:80, minStock:10, totalSold:0, emoji:"🍵" },
{ id:"m3", name:"كابتشينو", nameEn:"Cappuccino", price:5000, category:"hot_drinks", stock:60, minStock:8, totalSold:0, emoji:"☕" },
{ id:"m4", name:"لاتيه", nameEn:"Latte", price:5500, category:"hot_drinks", stock:60, minStock:8, totalSold:0, emoji:"☕" },
{ id:"m15", name:"أمريكانو", nameEn:"Americano", price:4000, category:"hot_drinks", stock:60, minStock:8, totalSold:0, emoji:"☕" },
{ id:"m16", name:"شوكولاتة ساخنة", nameEn:"Hot Chocolate", price:5000, category:"hot_drinks", stock:40, minStock:5, totalSold:0, emoji:"🫗" },
{ id:"m5", name:"موهيتو", nameEn:"Mojito", price:6000, category:"cold_drinks", stock:40, minStock:5, totalSold:0, emoji:"🍹" },
{ id:"m6", name:"عصير ليمون", nameEn:"Lemon Juice", price:4000, category:"cold_drinks", stock:50, minStock:5, totalSold:0, emoji:"🍋" },
{ id:"m7", name:"ماء معدني", nameEn:"Water", price:1000, category:"cold_drinks", stock:200, minStock:20, totalSold:0, emoji:"💧" },
{ id:"m17", name:"سموذي مانجو", nameEn:"Mango Smoothie", price:7000, category:"cold_drinks", stock:30, minStock:5, totalSold:0, emoji:"🥭" },
{ id:"m18", name:"عصير برتقال", nameEn:"Orange Juice", price:5000, category:"cold_drinks", stock:40, minStock:5, totalSold:0, emoji:"🍊" },
{ id:"m8", name:"ساندويتش دجاج", nameEn:"Chicken Sandwich", price:8000, category:"food", stock:30, minStock:5, totalSold:0, emoji:"🥪" },
{ id:"m9", name:"بيتزا صغيرة", nameEn:"Small Pizza", price:15000, category:"food", stock:20, minStock:3, totalSold:0, emoji:"🍕" },
{ id:"m10", name:"كيكة شوكولاتة", nameEn:"Chocolate Cake", price:7000, category:"food", stock:15, minStock:3, totalSold:0, emoji:"🍰" },
{ id:"m19", name:"ساندويتش فلافل", nameEn:"Falafel Sandwich", price:5000, category:"food", stock:25, minStock:5, totalSold:0, emoji:"🥙" },
{ id:"m11", name:"معسل تفاح", nameEn:"Apple Hookah", price:12000, category:"hookah", stock:50, minStock:5, totalSold:0, emoji:"💨" },
{ id:"m12", name:"معسل عنب", nameEn:"Grape Hookah", price:12000, category:"hookah", stock:50, minStock:5, totalSold:0, emoji:"💨" },
{ id:"m13", name:"معسل نعناع", nameEn:"Mint Hookah", price:12000, category:"hookah", stock:50, minStock:5, totalSold:0, emoji:"💨" },
{ id:"m20", name:"معسل توت", nameEn:"Berry Hookah", price:13000, category:"hookah", stock:40, minStock:5, totalSold:0, emoji:"💨" },
{ id:"m14", name:"فحم إضافي", nameEn:"Extra Charcoal", price:3000, category:"hookah", stock:100, minStock:10, totalSold:0, emoji:"🔥" },
];
// ══════════════════════════════════════════════════════════════
export const useStore = () => {
const [users, setUsersRaw] = useState(() => ls.get("nc_users", DEFAULT_USERS));
const [menu, setMenuRaw] = useState(() => ls.get("nc_menu", DEFAULT_MENU));
const [orders, setOrdersRaw] = useState(() => ls.get("nc_orders", []));
const [notifications, setNotificationsRaw] = useState(() => ls.get("nc_notifs", []));
const [cashLog, setCashLogRaw] = useState(() => ls.get("nc_cash", []));
const [tables, setTablesRaw] = useState(() => ls.get("nc_tables", []));
const [debts, setDebtsRaw] = useState(() => ls.get("nc_debts", []));
const [expenses, setExpensesRaw] = useState(() => ls.get("nc_expenses", []));
const [settings, setSettingsRaw] = useState(() => ls.get("nc_settings", DEFAULT_SETTINGS));
const [syncing, setSyncing] = useState(false);
const [cloudReady, setCloudReady] = useState(false);
// ── setUsers: يكتب إلى Supabase ────────────────────────────
const setUsers = useCallback((v) => {
setUsersRaw(p => {
const next = typeof v==="function"?v(p):v;
ls.set("nc_users",next); broadcast("nc_users",next);
if (SUPABASE_READY) {
// كتابة المستخدمين الجدد أو المحدّثين
next.forEach(u => {
const old = p.find(x=>x.id===u.id);
if (!old || JSON.stringify(old)!==JSON.stringify(u)) sbWrite.user(u);
});
// حذف المستخدمين المحذوفين
p.forEach(u => {
if (!next.find(x=>x.id===u.id)) sbWrite.deleteUser(u.id);
});
}
return next;
});
}, []);
// ── setMenu: يكتب إلى Supabase ─────────────────────────────
const setMenu = useCallback((v) => {
setMenuRaw(p => {
const next = typeof v==="function"?v(p):v;
ls.set("nc_menu",next); broadcast("nc_menu",next);
if (SUPABASE_READY) {
next.forEach(m => {
const old = p.find(x=>x.id===m.id);
if (!old || JSON.stringify(old)!==JSON.stringify(m)) sbWrite.menuItem(m);
});
p.forEach(m => {
if (!next.find(x=>x.id===m.id)) sbWrite.deleteMenuItem(m.id);
});
}
return next;
});
}, []);
// ── setOrders ───────────────────────────────────────────────
const setOrders = useCallback((v) => {
setOrdersRaw(p => {
const next = typeof v==="function"?v(p):v;
ls.set("nc_orders",next); broadcast("nc_orders",next);
if (SUPABASE_READY) {
const changed = next.filter(o => {
const old = p.find(x=>x.id===o.id);
return !old || old.status!==o.status || old.paymentType!==o.paymentType;
});
changed.forEach(o => sbWrite.order(o));
}
return next;
});
}, []);
// ── setNotifications ────────────────────────────────────────
const setNotifications = useCallback((v) => {
setNotificationsRaw(p => {
const d=typeof v==="function"?v(p):v;
ls.set("nc_notifs",d); broadcast("nc_notifs",d); return d;
});
}, []);
// ── setCashLog ──────────────────────────────────────────────
const setCashLog = useCallback((v) => {
setCashLogRaw(p => {
const next = typeof v==="function"?v(p):v;
ls.set("nc_cash",next); broadcast("nc_cash",next);
if (SUPABASE_READY) {
const prevIds = new Set(p.map(e=>e.id));
next.filter(e=>!prevIds.has(e.id)).forEach(e=>sbWrite.cashLog(e));
}
return next;
});
}, []);
// ── setTables ───────────────────────────────────────────────
const setTables = useCallback((v) => {
setTablesRaw(p => {
const d=typeof v==="function"?v(p):v;
ls.set("nc_tables",d); broadcast("nc_tables",d); return d;
});
}, []);
// ── setDebts ────────────────────────────────────────────────
const setDebts = useCallback((v) => {
setDebtsRaw(p => {
const next = typeof v==="function"?v(p):v;
ls.set("nc_debts",next); broadcast("nc_debts",next);
if (SUPABASE_READY) {
next.forEach(d => {
const old = p.find(x=>x.id===d.id);
if (!old || old.remaining!==d.remaining || old.settled!==d.settled) sbWrite.debt(d);
});
}
return next;
});
}, []);
// ── setExpenses ─────────────────────────────────────────────
const setExpenses = useCallback((v) => {
setExpensesRaw(p => {
const next = typeof v==="function"?v(p):v;
ls.set("nc_expenses",next); broadcast("nc_expenses",next);
if (SUPABASE_READY) {
const prevIds = new Set(p.map(e=>e.id));
next.filter(e=>!prevIds.has(e.id)).forEach(e=>sbWrite.expense(e));
}
return next;
});
}, []);
// ── setSettings ─────────────────────────────────────────────
const setSettings = useCallback((v) => {
setSettingsRaw(p => {
const d=typeof v==="function"?v(p):v;
ls.set("nc_settings",d); broadcast("nc_settings",d); return d;
});
}, []);
// ══════════════════════════════════════════════════════════
// BroadcastChannel — مزامنة بين تبويبات نفس الجهاز
// ══════════════════════════════════════════════════════════
useEffect(() => {
if (!bc) return;
const handler = (e) => {
const {key,data}=e.data;
switch(key){
case "nc_users": setUsersRaw(data); break;
case "nc_menu": setMenuRaw(data); break;
case "nc_orders": setOrdersRaw(data); break;
case "nc_notifs": setNotificationsRaw(data); break;
case "nc_cash": setCashLogRaw(data); break;
case "nc_tables": setTablesRaw(data); break;
case "nc_debts": setDebtsRaw(data); break;
case "nc_expenses": setExpensesRaw(data); break;
case "nc_settings": setSettingsRaw(data); break;
}
};
bc.addEventListener("message",handler);
return ()=>bc.removeEventListener("message",handler);
},[]);
// storage event
useEffect(() => {
const handler=(e)=>{
if(!e.key||!e.newValue) return;
try{
const data=JSON.parse(e.newValue);
switch(e.key){
case "nc_users": setUsersRaw(data); break;
case "nc_menu": setMenuRaw(data); break;
case "nc_orders": setOrdersRaw(data); break;
case "nc_notifs": setNotificationsRaw(data); break;
case "nc_cash": setCashLogRaw(data); break;
case "nc_tables": setTablesRaw(data); break;
case "nc_debts": setDebtsRaw(data); break;
case "nc_expenses": setExpensesRaw(data); break;
case "nc_settings": setSettingsRaw(data); break;
}
}catch{}
};
window.addEventListener("storage",handler);
return ()=>window.removeEventListener("storage",handler);
},[]);
// ══════════════════════════════════════════════════════════
// Supabase — تحميل البيانات عند الفتح
// ══════════════════════════════════════════════════════════
useEffect(()=>{
if(!SUPABASE_READY) return;
setSyncing(true);
Promise.all([
supabase.from("orders").select("*").order("created_at",{ascending:false}).limit(500),
supabase.from("menu_items").select("*").order("category"),
supabase.from("profiles").select("*"),
supabase.from("debts").select("*").order("date",{ascending:false}),
supabase.from("expenses").select("*").order("date",{ascending:false}),
supabase.from("cash_log").select("*").order("at",{ascending:false}).limit(200),
]).then(([ord,men,prof,dbt,exp,cash])=>{
if(ord.data?.length) {setOrdersRaw(ord.data); ls.set("nc_orders",ord.data);}
if(men.data?.length) {setMenuRaw(men.data); ls.set("nc_menu",men.data);}
if(prof.data?.length) {setUsersRaw(prof.data); ls.set("nc_users",prof.data);}
if(dbt.data?.length) {setDebtsRaw(dbt.data); ls.set("nc_debts",dbt.data);}
if(exp.data?.length) {setExpensesRaw(exp.data); ls.set("nc_expenses",exp.data);}
if(cash.data?.length) {setCashLogRaw(cash.data); ls.set("nc_cash",cash.data);}
setCloudReady(true);
}).catch(()=>{}).finally(()=>setSyncing(false));
},[]);
// ══════════════════════════════════════════════════════════
// Supabase Realtime — استقبال التغييرات من الأجهزة الأخرى
// ══════════════════════════════════════════════════════════
// الطلبات
useEffect(()=>{
if(!SUPABASE_READY) return;
return subscribeOrders(
(r)=>setOrdersRaw(p=>{const n=[r,...p.filter(o=>o.id!==r.id)];ls.set("nc_orders",n);broadcast("nc_orders",n);return n;}),
(r)=>setOrdersRaw(p=>{const n=p.map(o=>o.id===r.id?r:o);ls.set("nc_orders",n);broadcast("nc_orders",n);return n;}),
(r)=>setOrdersRaw(p=>{const n=p.filter(o=>o.id!==r.id);ls.set("nc_orders",n);broadcast("nc_orders",n);return n;}),
);
},[]);
// الديون
useEffect(()=>{
if(!SUPABASE_READY) return;
const ch=supabase.channel("debts-rt")
.on("postgres_changes",{event:"*",schema:"public",table:"debts"},(p)=>{
if(p.eventType==="INSERT"||p.eventType==="UPDATE"){
setDebtsRaw(prev=>{const n=[p.new,...prev.filter(d=>d.id!==p.new.id)];ls.set("nc_debts",n);broadcast("nc_debts",n);return n;});
}
if(p.eventType==="DELETE"){
setDebtsRaw(prev=>{const n=prev.filter(d=>d.id!==p.old.id);ls.set("nc_debts",n);broadcast("nc_debts",n);return n;});
}
}).subscribe();
return ()=>supabase.removeChannel(ch);
},[]);
// الموظفين — realtime
useEffect(()=>{
if(!SUPABASE_READY) return;
const ch=supabase.channel("profiles-rt")
.on("postgres_changes",{event:"*",schema:"public",table:"profiles"},(p)=>{
if(p.eventType==="INSERT"||p.eventType==="UPDATE"){
setUsersRaw(prev=>{const n=[p.new,...prev.filter(u=>u.id!==p.new.id)];ls.set("nc_users",n);broadcast("nc_users",n);return n;});
}
if(p.eventType==="DELETE"){
setUsersRaw(prev=>{const n=prev.filter(u=>u.id!==p.old.id);ls.set("nc_users",n);broadcast("nc_users",n);return n;});
}
}).subscribe();
return ()=>supabase.removeChannel(ch);
},[]);
// المنيو — realtime
useEffect(()=>{
if(!SUPABASE_READY) return;
const ch=supabase.channel("menu-rt")
.on("postgres_changes",{event:"*",schema:"public",table:"menu_items"},(p)=>{
if(p.eventType==="INSERT"||p.eventType==="UPDATE"){
setMenuRaw(prev=>{const n=[p.new,...prev.filter(m=>m.id!==p.new.id)];ls.set("nc_menu",n);broadcast("nc_menu",n);return n;});
}
if(p.eventType==="DELETE"){
setMenuRaw(prev=>{const n=prev.filter(m=>m.id!==p.old.id);ls.set("nc_menu",n);broadcast("nc_menu",n);return n;});
}
}).subscribe();
return ()=>supabase.removeChannel(ch);
},[]);
// المصاريف — realtime
useEffect(()=>{
if(!SUPABASE_READY) return;
const ch=supabase.channel("expenses-rt")
.on("postgres_changes",{event:"*",schema:"public",table:"expenses"},(p)=>{
if(p.eventType==="INSERT"||p.eventType==="UPDATE"){
setExpensesRaw(prev=>{const n=[p.new,...prev.filter(e=>e.id!==p.new.id)];ls.set("nc_expenses",n);broadcast("nc_expenses",n);return n;});
}
if(p.eventType==="DELETE"){
setExpensesRaw(prev=>{const n=prev.filter(e=>e.id!==p.old.id);ls.set("nc_expenses",n);broadcast("nc_expenses",n);return n;});
}
}).subscribe();
return ()=>supabase.removeChannel(ch);
},[]);
return {
users,setUsers, menu,setMenu, orders,setOrders,
notifications,setNotifications, cashLog,setCashLog,
tables,setTables, debts,setDebts, expenses,setExpenses,
settings,setSettings, syncing,cloudReady,
};
};
