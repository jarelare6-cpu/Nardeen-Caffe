// src/lib/store.js — Nardeen Caffe — Cross-Device Sync
import { useState, useCallback, useEffect } from "react";
import { supabase, SUPABASE_READY, subscribeOrders } from "./supabase";

const ls = {
  get: (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
  set: (k, v)   => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("nardeen_sync") : null;
const broadcast = (key, data) => { if (bc) bc.postMessage({ key, data, ts: Date.now() }); };

// ── كتابة إلى Supabase (للمزامنة بين الأجهزة) ──────────────────────────────
const sbWrite = {
  order: async (order) => {
    if (!SUPABASE_READY) return;
    await supabase.from("orders").upsert({
      id: order.id,
      order_num: order.orderNum,
      customer_name: order.customerName,
      customer_id: order.customerId,
      table_num: order.table,
      items: order.items,
      total: order.total,
      status: order.status,
      payment_type: order.paymentType,
      notes: order.notes,
      created_at: order.createdAt,
      paid_at: order.paidAt || null,
      paid_by: order.paidBy || null,
      discount: order.discount || 0,
    }, { onConflict: "id" });
  },
  debt: async (debt) => {
    if (!SUPABASE_READY) return;
    await supabase.from("debts").upsert({
      id: debt.id,
      customer_name: debt.customerName,
      amount: debt.amount,
      remaining: debt.remaining,
      settled: debt.settled,
      settled_at: debt.settledAt || null,
      date: debt.date,
      notes: debt.notes || "",
      created_by: debt.createdBy || "",
      order_id: debt.orderId || null,
    }, { onConflict: "id" });
  },
  expense: async (expense) => {
    if (!SUPABASE_READY) return;
    await supabase.from("expenses").upsert({
      id: expense.id,
      label: expense.label,
      amount: expense.amount,
      date: expense.date,
      by: expense.by || "",
      notes: expense.notes || "",
    }, { onConflict: "id" });
  },
  cashLog: async (entry) => {
    if (!SUPABASE_READY) return;
    await supabase.from("cash_log").upsert({
      id: entry.id,
      order_id: entry.orderId || null,
      order_num: entry.orderNum || "",
      amount: entry.amount,
      at: entry.at,
      by: entry.by || "",
      type: entry.type || "sale",
    }, { onConflict: "id" });
  },
};

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
  { id:"m1",  name:"قهوة عربية",     nameEn:"Arabic Coffee",    price:2500,  category:"hot_drinks",  stock:100, minStock:10, totalSold:0, emoji:"☕" },
  { id:"m2",  name:"شاي",            nameEn:"Tea",              price:1500,  category:"hot_drinks",  stock:80,  minStock:10, totalSold:0, emoji:"🍵" },
  { id:"m3",  name:"كابتشينو",       nameEn:"Cappuccino",       price:5000,  category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"☕" },
  { id:"m4",  name:"لاتيه",          nameEn:"Latte",            price:5500,  category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"☕" },
  { id:"m15", name:"أمريكانو",       nameEn:"Americano",        price:4000,  category:"hot_drinks",  stock:60,  minStock:8,  totalSold:0, emoji:"☕" },
  { id:"m16", name:"شوكولاتة ساخنة", nameEn:"Hot Chocolate",    price:5000,  category:"hot_drinks",  stock:40,  minStock:5,  totalSold:0, emoji:"🫗" },
  { id:"m5",  name:"موهيتو",         nameEn:"Mojito",           price:6000,  category:"cold_drinks", stock:40,  minStock:5,  totalSold:0, emoji:"🍹" },
  { id:"m6",  name:"عصير ليمون",     nameEn:"Lemon Juice",      price:4000,  category:"cold_drinks", stock:50,  minStock:5,  totalSold:0, emoji:"🍋" },
  { id:"m7",  name:"ماء معدني",      nameEn:"Water",            price:1000,  category:"cold_drinks", stock:200, minStock:20, totalSold:0, emoji:"💧" },
  { id:"m17", name:"سموذي مانجو",    nameEn:"Mango Smoothie",   price:7000,  category:"cold_drinks", stock:30,  minStock:5,  totalSold:0, emoji:"🥭" },
  { id:"m18", name:"عصير برتقال",    nameEn:"Orange Juice",     price:5000,  category:"cold_drinks", stock:40,  minStock:5,  totalSold:0, emoji:"🍊" },
  { id:"m8",  name:"ساندويتش دجاج",  nameEn:"Chicken Sandwich", price:8000,  category:"food",        stock:30,  minStock:5,  totalSold:0, emoji:"🥪" },
  { id:"m9",  name:"بيتزا صغيرة",   nameEn:"Small Pizza",      price:15000, category:"food",        stock:20,  minStock:3,  totalSold:0, emoji:"🍕" },
  { id:"m10", name:"كيكة شوكولاتة", nameEn:"Chocolate Cake",   price:7000,  category:"food",        stock:15,  minStock:3,  totalSold:0, emoji:"🍰" },
  { id:"m19", name:"ساندويتش فلافل", nameEn:"Falafel Sandwich", price:5000,  category:"food",        stock:25,  minStock:5,  totalSold:0, emoji:"🥙" },
  { id:"m11", name:"معسل تفاح",      nameEn:"Apple Hookah",     price:12000, category:"hookah",      stock:50,  minStock:5,  totalSold:0, emoji:"💨" },
  { id:"m12", name:"معسل عنب",       nameEn:"Grape Hookah",     price:12000, category:"hookah",      stock:50,  minStock:5,  totalSold:0, emoji:"💨" },
  { id:"m13", name:"معسل نعناع",     nameEn:"Mint Hookah",      price:12000, category:"hookah",      stock:50,  minStock:5,  totalSold:0, emoji:"💨" },
  { id:"m20", name:"معسل توت",       nameEn:"Berry Hookah",     price:13000, category:"hookah",      stock:40,  minStock:5,  totalSold:0, emoji:"💨" },
  { id:"m14", name:"فحم إضافي",      nameEn:"Extra Charcoal",   price:3000,  category:"hookah",      stock:100, minStock:10, totalSold:0, emoji:"🔥" },
];

export const useStore = () => {
  const [users,         setUsersRaw]        = useState(() => ls.get("nc_users",    DEFAULT_USERS));
  const [menu,          setMenuRaw]          = useState(() => ls.get("nc_menu",     DEFAULT_MENU));
  const [orders,        setOrdersRaw]        = useState(() => ls.get("nc_orders",   []));
  const [notifications, setNotificationsRaw] = useState(() => ls.get("nc_notifs",   []));
  const [cashLog,       setCashLogRaw]       = useState(() => ls.get("nc_cash",     []));
  const [tables,        setTablesRaw]        = useState(() => ls.get("nc_tables",   []));
  const [debts,         setDebtsRaw]         = useState(() => ls.get("nc_debts",    []));
  const [expenses,      setExpensesRaw]      = useState(() => ls.get("nc_expenses", []));
  const [settings,      setSettingsRaw]      = useState(() => ls.get("nc_settings", DEFAULT_SETTINGS));
  const [syncing,       setSyncing]          = useState(false);
  const [cloudReady,    setCloudReady]       = useState(false);

  const setUsers = useCallback((v) => {
    setUsersRaw(p => { const d = typeof v==="function"?v(p):v; ls.set("nc_users",d); broadcast("nc_users",d); return d; });
  }, []);
  const setMenu = useCallback((v) => {
    setMenuRaw(p => { const d = typeof v==="function"?v(p):v; ls.set("nc_menu",d); broadcast("nc_menu",d); return d; });
  }, []);
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
  const setNotifications = useCallback((v) => {
    setNotificationsRaw(p => { const d=typeof v==="function"?v(p):v; ls.set("nc_notifs",d); broadcast("nc_notifs",d); return d; });
  }, []);
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
  const setTables = useCallback((v) => {
    setTablesRaw(p => { const d=typeof v==="function"?v(p):v; ls.set("nc_tables",d); broadcast("nc_tables",d); return d; });
  }, []);
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
  const setSettings = useCallback((v) => {
    setSettingsRaw(p => { const d=typeof v==="function"?v(p):v; ls.set("nc_settings",d); broadcast("nc_settings",d); return d; });
  }, []);

  // BroadcastChannel
  useEffect(() => {
    if (!bc) return;
    const handler = (e) => {
      const {key,data}=e.data;
      switch(key){
        case "nc_users":    setUsersRaw(data);        break;
        case "nc_menu":     setMenuRaw(data);          break;
        case "nc_orders":   setOrdersRaw(data);        break;
        case "nc_notifs":   setNotificationsRaw(data); break;
        case "nc_cash":     setCashLogRaw(data);       break;
        case "nc_tables":   setTablesRaw(data);        break;
        case "nc_debts":    setDebtsRaw(data);         break;
        case "nc_expenses": setExpensesRaw(data);      break;
        case "nc_settings": setSettingsRaw(data);      break;
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
          case "nc_users":    setUsersRaw(data);        break;
          case "nc_menu":     setMenuRaw(data);          break;
          case "nc_orders":   setOrdersRaw(data);        break;
          case "nc_notifs":   setNotificationsRaw(data); break;
          case "nc_cash":     setCashLogRaw(data);       break;
          case "nc_tables":   setTablesRaw(data);        break;
          case "nc_debts":    setDebtsRaw(data);         break;
          case "nc_expenses": setExpensesRaw(data);      break;
          case "nc_settings": setSettingsRaw(data);      break;
        }
      }catch{}
    };
    window.addEventListener("storage",handler);
    return ()=>window.removeEventListener("storage",handler);
  },[]);

  // Supabase: load
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
      if(ord.data?.length)  {setOrdersRaw(ord.data);   ls.set("nc_orders",ord.data);}
      if(men.data?.length)  {setMenuRaw(men.data);      ls.set("nc_menu",men.data);}
      if(prof.data?.length) {setUsersRaw(prof.data);   ls.set("nc_users",prof.data);}
      if(dbt.data?.length)  {setDebtsRaw(dbt.data);    ls.set("nc_debts",dbt.data);}
      if(exp.data?.length)  {setExpensesRaw(exp.data); ls.set("nc_expenses",exp.data);}
      if(cash.data?.length) {setCashLogRaw(cash.data); ls.set("nc_cash",cash.data);}
      setCloudReady(true);
    }).catch(()=>{}).finally(()=>setSyncing(false));
  },[]);

  // Supabase realtime orders
  useEffect(()=>{
    if(!SUPABASE_READY) return;
    return subscribeOrders(
      (r)=>setOrdersRaw(p=>{const n=[r,...p.filter(o=>o.id!==r.id)];ls.set("nc_orders",n);broadcast("nc_orders",n);return n;}),
      (r)=>setOrdersRaw(p=>{const n=p.map(o=>o.id===r.id?r:o);ls.set("nc_orders",n);broadcast("nc_orders",n);return n;}),
      (r)=>setOrdersRaw(p=>{const n=p.filter(o=>o.id!==r.id);ls.set("nc_orders",n);broadcast("nc_orders",n);return n;}),
    );
  },[]);

  // Supabase realtime debts
  useEffect(()=>{
    if(!SUPABASE_READY) return;
    const ch=supabase.channel("debts-rt")
      .on("postgres_changes",{event:"*",schema:"public",table:"debts"},(p)=>{
        if(p.eventType==="INSERT"||p.eventType==="UPDATE"){
          setDebtsRaw(prev=>{
            const n=[p.new,...prev.filter(d=>d.id!==p.new.id)];
            ls.set("nc_debts",n);broadcast("nc_debts",n);return n;
          });
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
