// ╔══════════════════════════════════════════════════════════════════╗
// ║          Nardeen Caffe — ناردين كافيه  v3.0                      ║
// ║          بإدارة يحيى داؤود                                       ║
// ╚══════════════════════════════════════════════════════════════════╝

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore, checkSessionExpiry, touchSession } from "./lib/store.js";
import { SUPABASE_READY, sbDeleteAll, sbDelete, sbUpsert, sbFetch, outboxCount, flushOutbox } from "./lib/supabase.js";
import OutdoorScreen from "./OutdoorScreen.jsx";
import { Toast, PWABanner, GlobalStyle } from "./uikit.jsx";
import { ROLES } from "./constants.js";
import { LoginScreen, CustomerPortal } from "./CustomerScreens.jsx";
import { HomeScreen } from "./HomeScreen.jsx";
import { playOrderAlert, exportToExcel, generateTableQR, checkStockAlerts, notifyLowStock, sendReceiptWhatsApp, printKitchenTicket, getLoyaltyStatus, calcLoyaltyDiscount, getPartialPaymentStatus, getStaffReport, getPeakHoursData, getSalesComparison, calcShiftSummary, getOrderUrgency, getAvgPrepTime, calcEarnedPoints, getCustomerTier, pointsToValue } from "./lib/utils.js";

export default function NardeenCaffe(){
  const store = useStore();
  // ── FIX 1: حفظ المستخدم في sessionStorage لمنع تسجيل الخروج عند التحديث ──
  const [user,setUser]=useState(()=>{
    try{return checkSessionExpiry();}catch{return null;}
  });
  const [screen,setScreen]=useState(()=>{
    try{const s=checkSessionExpiry();return s?"home":"login";}catch{return "login";}
  });
  const [toast,setToast]=useState(null);
  const [dm,setDm]=useState(()=>localStorage.getItem("nc_dark")==="1");
  const [offline,setOffline]=useState(()=>typeof navigator!=="undefined"&&!navigator.onLine);
  const [pending,setPending]=useState(()=>{try{return outboxCount();}catch{return 0;}});
  const prevLen=useRef(store.orders.length);

  // ── offline-first: مؤشّر الاتصال + تفريغ الطابور الصادر عند العودة ──
  useEffect(()=>{
    const upd=()=>setOffline(!navigator.onLine);
    const onOutbox=(e)=>setPending(e.detail?.count ?? 0);
    window.addEventListener("online",upd);
    window.addEventListener("offline",upd);
    window.addEventListener("nc-outbox",onOutbox);
    if(navigator.onLine) flushOutbox();
    return()=>{
      window.removeEventListener("online",upd);
      window.removeEventListener("offline",upd);
      window.removeEventListener("nc-outbox",onOutbox);
    };
  },[]);

  // ── Phase 4: مُسجّل أخطاء عام للتشخيص (لا يكسر الواجهة) ──
  useEffect(()=>{
    const onErr=(e)=>console.error("[Nardeen] خطأ غير متوقع:",e.error||e.message||e);
    const onRej=(e)=>console.error("[Nardeen] وعد مرفوض:",e.reason);
    window.addEventListener("error",onErr);
    window.addEventListener("unhandledrejection",onRej);
    return()=>{window.removeEventListener("error",onErr);window.removeEventListener("unhandledrejection",onRej);};
  },[]);

  useEffect(()=>{
    if(store.orders.length>prevLen.current&&user) playOrderAlert();
    prevLen.current=store.orders.length;
  },[store.orders.length,user]);

  const showToast=useCallback((msg,type="success")=>{
    setToast({msg,type,id:Date.now()});
    setTimeout(()=>setToast(null),3500);
  },[]);

  const login=(u)=>{
    const u2=touchSession({...u,lastLogin:new Date().toISOString()});
    setUser(u2);setScreen("home");
  };
  const logout=()=>{
    setUser(null);setScreen("login");
    try{sessionStorage.removeItem("nc_session");}catch{}
  };

  // ── session timeout: تحقق كل دقيقة ──
  useEffect(()=>{
    if(!user) return;
    const iv=setInterval(()=>{
      const s=checkSessionExpiry();
      if(!s){logout();showToast("انتهت جلستك، يرجى تسجيل الدخول مجدداً","warn");}
      else touchSession(user);
    },60_000);
    return()=>clearInterval(iv);
  },[user]);

  const addNotification=useCallback((msg,targetRoles,orderId)=>{
    store.setNotifications(p=>[{
      id:Date.now().toString(),msg,targetRoles,orderId,
      createdAt:new Date().toISOString(),read:[]
    },...p.slice(0,49)]);
    // صوت الإشعار
    if(store.settings?.soundEnabled){
      try{
        const tone=store.settings?.soundTone||"bell";
        const ctx=new(window.AudioContext||window.webkitAudioContext)();
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.connect(gain);gain.connect(ctx.destination);
        if(tone==="bell"){osc.frequency.setValueAtTime(880,ctx.currentTime);osc.frequency.setValueAtTime(660,ctx.currentTime+0.1);}
        else if(tone==="chime"){osc.frequency.setValueAtTime(1046,ctx.currentTime);osc.frequency.setValueAtTime(784,ctx.currentTime+0.15);}
        else if(tone==="ping"){osc.frequency.setValueAtTime(1200,ctx.currentTime);}
        else{osc.frequency.setValueAtTime(440,ctx.currentTime);}
        gain.gain.setValueAtTime(0.3,ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.4);
        osc.start(ctx.currentTime);osc.stop(ctx.currentTime+0.4);
      }catch{}
    }
    // إشعار المتصفح
    if(store.settings?.notifyBrowser&&Notification?.permission==="granted"){
      new Notification("☕ ناردين كافيه",{body:msg,icon:"/favicon.ico"}).catch(()=>{});
    }
  },[store]);

  const unreadCount=store.notifications.filter(n=>
    n.targetRoles.includes(user?.role)&&!n.read.includes(user?.id)
  ).length;

  const settings = store.settings || {};

  return(
    <div style={{fontFamily:"'Tajawal',sans-serif",direction:"rtl",minHeight:"100vh",
      background:"var(--bg)",color:"var(--text)",transition:"background .3s,color .3s"}}>
      <GlobalStyle dm={dm} theme={store.settings?.appTheme||"default"}/>
      <Toast toast={toast}/>
      <PWABanner/>
      {(offline||pending>0)&&(
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:9999,
          background:offline?"#c62828":"#e65100",color:"#fff",textAlign:"center",
          padding:"6px 10px",fontSize:13,fontWeight:800,fontFamily:"'Tajawal',sans-serif",
          boxShadow:"0 2px 6px rgba(0,0,0,.3)"}}>
          {offline?"⚠ غير متصل — يعمل محليًا والبيانات محفوظة":"🔄 جارٍ المزامنة"}
          {pending>0?` • ${pending} عملية بانتظار الرفع`:""}
        </div>
      )}
      {screen==="login"&&<LoginScreen store={store} onLogin={login} showToast={showToast} dm={dm}/>}
      {screen==="home"&&user&&(
        user.role===ROLES.CUSTOMER
          ? <CustomerPortal user={user} store={store} onLogout={logout} showToast={showToast} addNotification={addNotification} dm={dm}/>
          : user.role===ROLES.OUTDOOR
          ? <OutdoorScreen user={user} store={store} onLogout={logout} showToast={showToast}/>
          : <HomeScreen user={user} store={store} onLogout={logout} showToast={showToast}
              addNotification={addNotification} unreadCount={unreadCount} dm={dm}
              toggleDark={()=>setDm(d=>{localStorage.setItem("nc_dark",d?"0":"1");return!d})}
              settings={settings}/>
      )}
    </div>
  );
}

// ═══════════════════════════════════
// LOGIN — FIX 2: اختيار زبون أو عامل من البداية
// ═══════════════════════════════════
