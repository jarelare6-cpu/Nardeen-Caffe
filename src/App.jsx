// ╔══════════════════════════════════════════════════════════════════╗
// ║          Nardeen Caffe — ناردين كافيه  v3.0                      ║
// ║          بإدارة يحيى داؤود                                       ║
// ╚══════════════════════════════════════════════════════════════════╝

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore, checkSessionExpiry, touchSession } from "./lib/store.js";
import { SUPABASE_READY, sbDeleteAll, sbDelete, sbUpsert, sbFetch, outboxCount, outboxFailedCount, outboxList, outboxFailed, outboxInProgress, lastSyncAt, retryFailed, flushOutbox, sbHeartbeat } from "./lib/supabase.js";
import { startMesh, mergeById } from "./lib/mesh.js";
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
  const [pending,setPending]=useState(()=>{try{return outboxCount();}catch{return 0;}});
  const [meshPeers,setMeshPeers]=useState(0);
  const [failed,setFailed]=useState(()=>{try{return outboxFailedCount();}catch{return 0;}});
  const [syncing,setSyncing]=useState(false);
  const [syncOpen,setSyncOpen]=useState(false);
  const meshRef=useRef(null);
  const bannerRef=useRef(null);
  const [bannerH,setBannerH]=useState(0);
  const prevLen=useRef(store.orders.length);

  // ── mesh تجريبي: تزامن P2P لعدة مجموعات عبر LAN (مطفأ افتراضيًا) ──
  // المخزون (menu) مستثنى عمدًا حتى ننفّذ مخزون CRDT (تفادي ضياع الخصم).
  const meshOn=!!store.settings?.meshEnabled;
  // قياس ارتفاع شريط المزامنة (يتغيّر حسب الحالة) لإزاحة الهيدر تحته بلا تغطية
  useEffect(()=>{
    const m=()=>setBannerH(bannerRef.current?bannerRef.current.offsetHeight:0);
    m();
    const t=setTimeout(m,60);
    window.addEventListener("resize",m);
    return ()=>{ clearTimeout(t); window.removeEventListener("resize",m); };
  },[offline,pending,failed,meshOn,meshPeers,syncing]);
  const meshSettersRef=useRef(null);
  meshSettersRef.current={orders:store.setOrders,tables:store.setTables,debts:store.setDebts,expenses:store.setExpenses,receipts:store.setReceipts};
  useEffect(()=>{
    if(!meshOn){ try{meshRef.current?.stop?.();}catch{} meshRef.current=null; setMeshPeers(0); return; }
    let active=true;
    startMesh({
      collections:["orders","tables","debts","expenses","receipts"],
      onPeers:(n)=>{ if(active) setMeshPeers(n); },
      onData:(name,items)=>{ try{ const setter=meshSettersRef.current?.[name]; if(setter) setter(prev=>mergeById(prev,items)); }catch{} }
    }).then(m=>{ if(active) meshRef.current=m; else m.stop(); }).catch(e=>console.warn("[mesh] init failed",e));
    return()=>{ active=false; try{meshRef.current?.stop?.();}catch{} meshRef.current=null; };
  },[meshOn]);
  // دفع المجموعات المحلية للأقران عند تغيّرها
  useEffect(()=>{ if(meshOn) try{meshRef.current?.push?.("orders",store.orders);}catch{} },[store.orders,meshOn]);
  useEffect(()=>{ if(meshOn) try{meshRef.current?.push?.("tables",store.tables);}catch{} },[store.tables,meshOn]);
  useEffect(()=>{ if(meshOn) try{meshRef.current?.push?.("debts",store.debts);}catch{} },[store.debts,meshOn]);
  useEffect(()=>{ if(meshOn) try{meshRef.current?.push?.("expenses",store.expenses);}catch{} },[store.expenses,meshOn]);
  useEffect(()=>{ if(meshOn) try{meshRef.current?.push?.("receipts",store.receipts);}catch{} },[store.receipts,meshOn]);

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

  // ── offline-first: مؤشّر الاتصال + تفريغ الطابور الصادر عند العودة ──
  useEffect(()=>{
    const upd=()=>setOffline(!navigator.onLine);
    const onOutbox=(e)=>{ setPending(e.detail?.count ?? 0); setFailed(e.detail?.failed ?? 0); setSyncing(!!e.detail?.inProgress); };
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
    if(store.settings?.notifyBrowser&&Notification?.permission==="granted"){
      new Notification("☕ ناردين كافيه",{body:msg,icon:"/favicon.ico"}).catch(()=>{});
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
      {(offline||pending>0||failed>0||meshOn)&&(
        <div onClick={()=>setSyncOpen(true)} ref={bannerRef} style={{position:"sticky",top:0,zIndex:9999,cursor:"pointer",
          background:offline?"#c62828":(failed>0?"#b71c1c":(pending>0?"#e65100":"#2e7d32")),color:"#fff",textAlign:"center",
          padding:"6px 10px",fontSize:13,fontWeight:800,fontFamily:"'Tajawal',sans-serif",
          boxShadow:"0 2px 6px rgba(0,0,0,.3)"}}>
          {offline?"⚠ غير متصل — يعمل محليًا والبيانات محفوظة":(syncing?"🔄 جارٍ الرفع الآن":(pending>0?"⏳ بانتظار الرفع":"🔗 المزامنة المباشرة فعّالة"))}
          {pending>0?` • ${pending} بانتظار`:""}
          {failed>0?` • ⚠ ${failed} فشل`:""}
          {meshOn?` • 🔗 ${meshPeers} جهاز`:""}
          <span style={{opacity:.85,marginInlineStart:8,fontSize:11}}>(اضغط للتفاصيل)</span>
        </div>
      )}
      {syncOpen&&<SyncPanel onClose={()=>setSyncOpen(false)}/>}
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
// لوحة حالة المزامنة (C) — تفاصيل الطابور الصادر
// ═══════════════════════════════════
function SyncPanel({onClose}){
  const [,setTick]=useState(0);
  useEffect(()=>{
    const h=()=>setTick(t=>t+1);
    window.addEventListener("nc-outbox",h);
    const iv=setInterval(h,1500);
    return()=>{window.removeEventListener("nc-outbox",h);clearInterval(iv);};
  },[]);
  let pend=[],fail=[],last=null,prog=false;
  try{pend=outboxList()||[];}catch{} try{fail=outboxFailed()||[];}catch{}
  try{last=lastSyncAt();}catch{} try{prog=outboxInProgress();}catch{}
  const byTable=(arr)=>{const m={};arr.forEach(e=>{m[e.table]=(m[e.table]||0)+1;});return Object.entries(m);};
  const fmt=(iso)=>{if(!iso)return "—";try{return new Date(iso).toLocaleString("ar");}catch{return iso;}};
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:10000,background:"rgba(0,0,0,.55)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--card,#1a1c33)",color:"var(--text,#eee)",borderRadius:14,padding:18,maxWidth:440,width:"100%",maxHeight:"85vh",overflow:"auto",fontFamily:"'Tajawal',sans-serif",direction:"rtl",border:"1px solid var(--border,#33365a)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <h3 style={{margin:0,fontSize:16,fontWeight:900}}>📡 حالة المزامنة</h3>
          <button onClick={onClose} style={{background:"none",border:"none",color:"inherit",fontSize:24,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
          {[["⏳ بانتظار",pend.length,"#e65100"],["🔄 قيد الرفع",prog?"نعم":"لا","#2e7d32"],["⚠ فشل دائم",fail.length,"#ff6b6b"]].map(([l,v,c])=>(
            <div key={l} style={{background:"rgba(255,255,255,.06)",borderRadius:10,padding:10,textAlign:"center"}}>
              <div style={{fontSize:11,opacity:.7}}>{l}</div><div style={{fontSize:18,fontWeight:900,color:c}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{fontSize:12,opacity:.85,marginBottom:12}}>آخر مزامنة ناجحة: <b>{fmt(last)}</b></div>
        {pend.length>0&&(<div style={{marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>بانتظار الرفع (حسب الجدول):</div>
          {byTable(pend).map(([t,n])=><div key={t} style={{fontSize:13,display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid var(--border,#2a2c44)"}}><span>{t}</span><span style={{fontWeight:700}}>{n}</span></div>)}
        </div>)}
        {fail.length>0&&(<div style={{marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:6,color:"#ff9a9a"}}>فشل دائم (تجاوز {fail[0]?.tries||5} محاولات):</div>
          {byTable(fail).map(([t,n])=><div key={t} style={{fontSize:13,display:"flex",justifyContent:"space-between",padding:"3px 0"}}><span>{t}</span><span style={{fontWeight:700}}>{n}</span></div>)}
          <div style={{fontSize:11,opacity:.7,marginTop:4}}>سبب آخر فشل: {fail[fail.length-1]?.lastError||"—"}</div>
        </div>)}
        {(pend.length===0&&fail.length===0)&&<div style={{fontSize:13,opacity:.7,textAlign:"center",padding:"10px 0"}}>لا عمليات معلّقة — كل شيء مرفوع ✅</div>}
        <div style={{display:"flex",gap:8,marginTop:10}}>
          <button onClick={()=>{try{flushOutbox();}catch{}}} style={{flex:1,background:"#2e7d32",color:"#fff",border:"none",borderRadius:9,padding:"10px",fontWeight:700,cursor:"pointer"}}>محاولة الرفع الآن</button>
          {fail.length>0&&<button onClick={()=>{try{retryFailed();}catch{}}} style={{flex:1,background:"#e65100",color:"#fff",border:"none",borderRadius:9,padding:"10px",fontWeight:700,cursor:"pointer"}}>إعادة الفاشلة</button>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════
// LOGIN — FIX 2: اختيار زبون أو عامل من البداية
// ═══════════════════════════════════
