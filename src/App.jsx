// ╔══════════════════════════════════════════════════════════════════╗
// ║          Nardeen Caffe — ناردين كافيه  v3.0                      ║
// ║          بإدارة يحيى داؤود                                       ║
// ╚══════════════════════════════════════════════════════════════════╝

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore, checkSessionExpiry, touchSession } from "./lib/store.js";
import { SUPABASE_READY, sbHeartbeat, logActivity, supabase } from "./lib/supabase.js";
import OutdoorScreen from "./OutdoorScreen.jsx";
import { Toast, PWABanner, GlobalStyle, ImageStyleContext } from "./uikit.jsx";
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
  const [rtStatus,setRtStatus]=useState("SUBSCRIBED"); // حالة المزامنة الفورية
  const [slowMsg,setSlowMsg]=useState(null);           // تنبيه بطء الاستجابة (>3 ثوانٍ)
  const [syncErr,setSyncErr]=useState(null);           // آخر خطأ مزامنة
  const [updateUrl,setUpdateUrl]=useState(null);
  const bannerRef=useRef(null);
  const [bannerH,setBannerH]=useState(0);
  const prevLen=useRef(store.orders.length);

  // قياس ارتفاع شريط المزامنة (يتغيّر حسب الحالة) لإزاحة الهيدر تحته بلا تغطية
  useEffect(()=>{
    const m=()=>setBannerH(bannerRef.current?bannerRef.current.offsetHeight:0);
    m();
    const t=setTimeout(m,60);
    window.addEventListener("resize",m);
    return ()=>{ clearTimeout(t); window.removeEventListener("resize",m); };
  },[offline,rtStatus,store.syncing,syncErr]);

  // فحص التحديثات داخل تطبيق أندرويد: قارن وقت بناء النسخة بآخر إصدار منشور
  useEffect(()=>{
    if(!(typeof window!=="undefined" && window.Capacitor?.isNativePlatform?.())) return;
    (async()=>{
      try{
        const r=await fetch("https://api.github.com/repos/jarelare6-cpu/Nardeen-Caffe/releases/latest",{headers:{Accept:"application/vnd.github+json"}});
        if(!r.ok) return;
        const j=await r.json();
        const pub=new Date(j.published_at||0).getTime();
        const built=new Date(__BUILD_TIME__).getTime();
        if(pub>built+60000) setUpdateUrl(j.html_url||"https://github.com/jarelare6-cpu/Nardeen-Caffe/releases/latest");
      }catch{}
    })();
  },[]);

  // ── نبض الجهاز للمراقبة عن بُعد (آمن الفشل) ──
  useEffect(()=>{
    if(!SUPABASE_READY) return;
    const devId=(()=>{try{let i=localStorage.getItem("nc_dev_id");if(!i){i="d"+Math.random().toString(36).slice(2,9);localStorage.setItem("nc_dev_id",i);}return i;}catch{return "d0";}})();
    const tag=(()=>{try{return localStorage.getItem("nc_dev_tag")||"?";}catch{return "?";}})();
    const beat=()=>{ try{ if(navigator.onLine&&user) sbHeartbeat({id:devId,label:`${tag} • ${user.name||user.role||"?"}`,role:user.role||""}); }catch{} };
    beat();
    const iv=setInterval(beat,45000);
    window.addEventListener("online",beat);
    return ()=>{ clearInterval(iv); window.removeEventListener("online",beat); };
  },[user]);

  // ── v22: أونلاين فقط — مؤشّر الاتصال + حالة المزامنة الفورية + تنبيه البطء ──
  useEffect(()=>{
    const upd=()=>setOffline(!navigator.onLine);
    const onRt=(e)=>setRtStatus(e.detail?.status||"SUBSCRIBED");
    const onSlow=(e)=>{
      setSlowMsg(`🐢 الاستجابة بطيئة (${((e.detail?.ms||0)/1000).toFixed(1)} ث) — تحقق من جودة الإنترنت`);
      setTimeout(()=>setSlowMsg(null),5000);
    };
    const onSyncErr=(e)=>{
      setSyncErr(`⚠ فشل حفظ (${e.detail?.table||"؟"}): ${e.detail?.message||""}`);
      setTimeout(()=>setSyncErr(null),7000);
    };
    window.addEventListener("online",upd);
    window.addEventListener("offline",upd);
    window.addEventListener("nc-rt",onRt);
    window.addEventListener("nc-slow",onSlow);
    window.addEventListener("nc-sync-error",onSyncErr);
    return()=>{
      window.removeEventListener("online",upd);
      window.removeEventListener("offline",upd);
      window.removeEventListener("nc-rt",onRt);
      window.removeEventListener("nc-slow",onSlow);
      window.removeEventListener("nc-sync-error",onSyncErr);
    };
  },[]);

  // ── v23: أرشفة الطلبات القديمة (>90 يوم) — مرة يومياً من جهاز الأدمن ──
  // آمنة الفشل: إن لم تكن دالة archive_old_orders منشأة بعد تُتجاهل بصمت.
  useEffect(()=>{
    if(!SUPABASE_READY||!supabase||!user||user.role!=="admin"||!navigator.onLine) return;
    try{
      const last=localStorage.getItem("nc_archive_at");
      if(last&&Date.now()-new Date(last).getTime()<86400000) return;
      supabase.rpc("archive_old_orders",{p_days:90}).then(({data,error})=>{
        if(error){ if(!/(function|does not exist|PGRST202)/i.test(error.message||"")) console.warn("archive:",error.message); return; }
        localStorage.setItem("nc_archive_at",new Date().toISOString());
        if(data>0) logActivity({action:"أرشفة تلقائية",details:`نُقل ${data} طلب قديم للأرشيف`,userName:"النظام",userRole:"system"});
      }).catch(()=>{});
    }catch{}
  },[user]);

  // ── Phase 4: مُسجّل أخطاء عام للتشخيص (لا يكسر الواجهة) ──
  useEffect(()=>{
    const onErr=(e)=>console.error("[Nardeen] خطأ غير متوقع:",e.error||e.message||e);
    const onRej=(e)=>console.error("[Nardeen] وعد مرفوض:",e.reason);
    window.addEventListener("error",onErr);
    window.addEventListener("unhandledrejection",onRej);
    return()=>{window.removeEventListener("error",onErr);window.removeEventListener("unhandledrejection",onRej);};
  },[]);

  useEffect(()=>{
    if(store.orders.length>prevLen.current&&user){
      try{
        const le=localStorage.getItem("nc_sound_enabled");
        const on = le!==null ? le==="1" : !!store.settings?.soundEnabled;
        if(on) playOrderAlert(localStorage.getItem("nc_sound_tone")||store.settings?.soundTone||"bell");
      }catch{}
    }
    prevLen.current=store.orders.length;
  },[store.orders.length,user]);

  const showToast=useCallback((msg,type="success")=>{
    setToast({msg,type,id:Date.now()});
    setTimeout(()=>setToast(null),3500);
  },[]);

  const login=(u)=>{
    const u2=touchSession({...u,lastLogin:new Date().toISOString()});
    setUser(u2);setScreen("home");
    logActivity({action:"تسجيل دخول",details:"",userName:u.name||u.username||"",userRole:u.role||"",branch:"main"});
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
    // صوت الإشعار — نغمة لكل جهاز (محلية) لتمييزه
    try{
      const le=localStorage.getItem("nc_sound_enabled");
      const soundOn = le!==null ? le==="1" : !!store.settings?.soundEnabled;
      if(soundOn) playOrderAlert(localStorage.getItem("nc_sound_tone")||store.settings?.soundTone||"bell");
    }catch{}
    // إشعار المتصفح
    // fix v23.1: Notification هو constructor وليس Promise — كان .catch يرمي TypeError
    if(store.settings?.notifyBrowser&&typeof Notification!=="undefined"&&Notification.permission==="granted"){
      try{ new Notification("☕ ناردين كافيه",{body:msg,icon:"/favicon.ico"}); }catch{}
    }
  },[store]);

  const unreadCount=store.notifications.filter(n=>
    n.targetRoles.includes(user?.role)&&!n.read.includes(user?.id)
  ).length;

  const settings = store.settings || {};

  return(
    <ImageStyleContext.Provider value={settings?.imageStyle||"real"}>
    <div style={{fontFamily:"'Tajawal',sans-serif",direction:"rtl",minHeight:"100vh",
      background:"var(--bg)",color:"var(--text)",transition:"background .3s,color .3s"}}>
      <GlobalStyle dm={dm} theme={store.settings?.appTheme||"default"}/>
      <Toast toast={toast}/>
      <PWABanner/>
      {(offline||store.syncing||(SUPABASE_READY&&rtStatus!=="SUBSCRIBED")||slowMsg||syncErr)&&(
        <div ref={bannerRef} style={{position:"sticky",top:0,zIndex:9999,
          background:offline?"#c62828":(syncErr?"#b71c1c":(slowMsg?"#e65100":"#1565c0")),color:"#fff",textAlign:"center",
          padding:"6px 10px",fontSize:13,fontWeight:800,fontFamily:"'Tajawal',sans-serif",
          boxShadow:"0 2px 6px rgba(0,0,0,.3)"}}>
          {offline
            ? "⚠ لا يوجد اتصال بالإنترنت — التطبيق يتطلب اتصالاً للعمل"
            : syncErr
            ? syncErr
            : slowMsg
            ? slowMsg
            : store.syncing
            ? "🔄 جارٍ المزامنة مع السحابة..."
            : "📡 جارٍ إعادة الاتصال بالمزامنة الفورية..."}
        </div>
      )}
      {updateUrl&&(
        <div onClick={()=>{try{window.open(updateUrl,"_system");}catch{try{window.open(updateUrl,"_blank");}catch{}}}}
          style={{position:"sticky",top:0,zIndex:9998,cursor:"pointer",background:"#1565c0",color:"#fff",
          textAlign:"center",padding:"7px 10px",fontSize:13,fontWeight:800,fontFamily:"'Tajawal',sans-serif",
          boxShadow:"0 2px 6px rgba(0,0,0,.3)"}}>
          🔄 تحديث متوفّر — اضغط للتنزيل والتثبيت
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
              settings={settings} topOffset={bannerH}/>
      )}
    </div>
    </ImageStyleContext.Provider>
  );
}

// ═══════════════════════════════════
// LOGIN — FIX 2: اختيار زبون أو عامل من البداية
// ═══════════════════════════════════
