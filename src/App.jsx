// ╔══════════════════════════════════════════════════════════════════╗
// ║          Nardeen Caffe — ناردين كافيه  v3.0                      ║
// ║          بإدارة يحيى داؤود                                       ║
// ╚══════════════════════════════════════════════════════════════════╝
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore } from "./lib/store.js";
import { SUPABASE_READY } from "./lib/supabase.js";
import { playOrderAlert, exportToExcel, generateTableQR, printOrder as utilPrint } from "./lib/utils.js";

// ═══════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════
const ROLES = {
  ADMIN:"admin", CASHIER:"cashier", BAR:"bar",
  HOOKAH:"hookah", WORKER:"worker", CUSTOMER:"customer"
};
const ROLE_LABELS = {
  admin:"مدير", cashier:"كاشير", bar:"بار",
  hookah:"أراكيل", worker:"عامل طلبات", customer:"زبون"
};
const ROLE_COLORS = {
  admin:"#c62828", cashier:"#1565c0", bar:"#6a1b9a",
  hookah:"#2e7d32", worker:"#e65100", customer:"#00695c"
};
const ORDER_STATUS = {
  PENDING:"pending", PREPARING:"preparing",
  READY:"ready", PAID:"paid", CANCELLED:"cancelled", DEBT:"debt"
};
const STATUS_LABELS = {
  pending:"قيد الانتظار", preparing:"قيد التحضير",
  ready:"جاهز", paid:"مدفوع", cancelled:"ملغي", debt:"دين"
};
const STATUS_COLORS = {
  pending:"#ff9800", preparing:"#1976d2",
  ready:"#2e7d32", paid:"#546e7a", cancelled:"#c62828", debt:"#6a1b9a"
};

// Category labels
const CAT_LABELS = {
  hot_drinks:"☕ مشروبات ساخنة",
  cold_drinks:"🧊 مشروبات باردة",
  food:"🍔 طعام",
  hookah:"💨 نرجيلة"
};
const CAT_ORDER = ["hot_drinks","cold_drinks","food","hookah"];

// Permissions per role
const PERMISSIONS = {
  dashboard:    ["admin","cashier"],
  order:        ["admin","cashier","worker"],
  orders:       ["admin","cashier","worker","bar","hookah"],
  cashier:      ["admin","cashier"],
  bar:          ["admin","bar"],
  hookah:       ["admin","hookah"],
  menu:         ["admin"],
  tables:       ["admin","cashier"],
  staff:        ["admin"],
  reports:      ["admin"],
  debts:        ["admin","cashier"],
  expenses:     ["admin","cashier"],
  settings:     ["admin"],
  customer_home:["customer"],
  myorders:     ["customer"],
};

const canAccess = (role, section) => (PERMISSIONS[section]||[]).includes(role);

// ═══════════════════════════════════
// PRINT WRAPPER
// ═══════════════════════════════════
const printOrder = (order, menu, copy, settings) => utilPrint(order, menu, copy, settings);

// حفظ سجل الفاتورة في Supabase
const saveReceipt = async (order, settings) => {
  try {
    const { supabase, SUPABASE_READY } = await import("./lib/supabase.js");
    if (!SUPABASE_READY) return;
    await supabase.from("receipts").upsert({
      id: "rcpt_" + order.id,
      order_id: order.id,
      order_num: order.orderNum || order.order_num,
      customer_name: order.customerName || order.customer_name || "",
      table_num: order.table || order.table_num || "",
      items: order.items,
      total: order.total,
      discount: order.discount || 0,
      payment_type: order.paymentType || "cash",
      notes: order.notes || "",
      created_by: order.workerName || "",
      created_at: order.createdAt || new Date().toISOString(),
      cafe_name: settings?.cafeName || "Nardeen Caffe",
    }, { onConflict: "id" });
  } catch(e) { console.error("receipt save:", e); }
};

// ═══════════════════════════════════
// GLOBAL CSS
// ═══════════════════════════════════
const THEMES = {
  default: { primary:"#c62828", secondary:"#1565c0", accent:"#f9a825" },
  green:   { primary:"#2e7d32", secondary:"#1b5e20", accent:"#66bb6a" },
  purple:  { primary:"#6a1b9a", secondary:"#4a148c", accent:"#ce93d8" },
  blue:    { primary:"#1565c0", secondary:"#0d47a1", accent:"#42a5f5" },
  gold:    { primary:"#f57f17", secondary:"#e65100", accent:"#ffd54f" },
};

const GlobalStyle = ({dm,theme="default"}) => {
  const t = THEMES[theme]||THEMES.default;
  return (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;900&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    :root{
      --red:${t.primary};--red-dark:${t.secondary};--green:#2e7d32;--gold:${t.accent};
      --bg:${dm?"#0d0d18":"#f4f6fa"};
      --card:${dm?"#16182a":"#ffffff"};
      --card2:${dm?"#1e2035":"#f0f2f8"};
      --border:${dm?"#2a2d4a":"#dde1ed"};
      --text:${dm?"#e8eaf6":"#1a1c2e"};
      --sub:${dm?"#8890b0":"#6b7280"};
      --shadow:${dm?"0 4px 24px rgba(0,0,0,.45)":"0 2px 16px rgba(30,40,80,.08)"};
      --radius:14px;
    }
    html,body{font-family:'Tajawal',sans-serif;direction:rtl;background:var(--bg);color:var(--text);overflow-x:hidden;min-height:100%;}
    #root{min-height:100vh;background:var(--bg);}
    button{cursor:pointer;font-family:inherit;direction:rtl}
    input,select,textarea{font-family:inherit;direction:rtl;background:var(--card);color:var(--text)}
    .card{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px}
    .input{width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;outline:none;transition:border .2s;background:var(--card);color:var(--text)}
    .input:focus{border-color:var(--red)}
    .btn{border:none;border-radius:10px;padding:10px 20px;font-weight:700;font-size:14px;transition:all .2s;display:inline-flex;align-items:center;gap:6px;justify-content:center}
    .btn:hover{filter:brightness(1.1);transform:translateY(-1px)}
    .btn:active{transform:translateY(0)}
    .btn-red{background:var(--red);color:#fff}
    .btn-green{background:var(--green);color:#fff}
    .btn-blue{background:#1565c0;color:#fff}
    .btn-ghost{background:transparent;border:1.5px solid var(--border);color:var(--text)}
    .badge{display:inline-flex;align-items:center;justify-content:center;border-radius:50px;font-size:11px;font-weight:700;padding:3px 9px}
    .s-pending{background:${dm?"rgba(255,152,0,.2)":"#fff3e0"};color:#e65100}
    .s-preparing{background:${dm?"rgba(25,118,210,.2)":"#e3f2fd"};color:#1565c0}
    .s-ready{background:${dm?"rgba(46,125,50,.2)":"#e8f5e9"};color:#2e7d32}
    .s-paid{background:${dm?"rgba(84,110,122,.2)":"#f5f5f5"};color:#546e7a}
    .s-cancelled{background:${dm?"rgba(198,40,40,.2)":"#ffebee"};color:#c62828}
    .s-debt{background:${dm?"rgba(106,27,154,.2)":"#f3e5f5"};color:#6a1b9a}
    .fade-in{animation:fadeIn .3s ease}
    @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .slide-in{animation:slideIn .3s ease}
    @keyframes slideIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
    .pulse{animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
    .scroll-hide::-webkit-scrollbar{display:none}
    .scroll-hide{-ms-overflow-style:none;scrollbar-width:none}
    @media(max-width:640px){
      .hide-mobile{display:none!important}
      .mobile-full{width:100%!important;grid-column:1/-1!important}
      .order-grid{grid-template-columns:1fr!important;height:auto!important}
      .order-cart{border-radius:var(--radius)!important;max-height:none!important}
    }
    @media(min-width:641px){.show-mobile-only{display:none!important}}
  `}</style>
  );
}


// ═══════════════════════════════════
// NOTIFICATION SOUNDS
// ═══════════════════════════════════
const SOUNDS={
  success:()=>{try{const a=new(window.AudioContext||window.webkitAudioContext)();const o=a.createOscillator();const g=a.createGain();o.connect(g);g.connect(a.destination);o.frequency.setValueAtTime(880,a.currentTime);o.frequency.exponentialRampToValueAtTime(1320,a.currentTime+0.1);g.gain.setValueAtTime(0.3,a.currentTime);g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+0.4);o.start();o.stop(a.currentTime+0.4);}catch{}},
  error:()=>{try{const a=new(window.AudioContext||window.webkitAudioContext)();const o=a.createOscillator();const g=a.createGain();o.connect(g);g.connect(a.destination);o.type="sawtooth";o.frequency.setValueAtTime(200,a.currentTime);o.frequency.exponentialRampToValueAtTime(100,a.currentTime+0.3);g.gain.setValueAtTime(0.3,a.currentTime);g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+0.3);o.start();o.stop(a.currentTime+0.3);}catch{}},
  warn:()=>{try{const a=new(window.AudioContext||window.webkitAudioContext)();[0,0.15].forEach(t=>{const o=a.createOscillator();const g=a.createGain();o.connect(g);g.connect(a.destination);o.frequency.value=660;g.gain.setValueAtTime(0.25,a.currentTime+t);g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+t+0.12);o.start(a.currentTime+t);o.stop(a.currentTime+t+0.12);});}catch{}},
  order:()=>{try{const a=new(window.AudioContext||window.webkitAudioContext)();[0,0.12,0.24].forEach((t,i)=>{const o=a.createOscillator();const g=a.createGain();o.connect(g);g.connect(a.destination);o.frequency.value=[523,659,784][i];g.gain.setValueAtTime(0.3,a.currentTime+t);g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+t+0.18);o.start(a.currentTime+t);o.stop(a.currentTime+t+0.18);});}catch{}},
  debt:()=>{try{const a=new(window.AudioContext||window.webkitAudioContext)();[0,0.2].forEach((t,i)=>{const o=a.createOscillator();const g=a.createGain();o.connect(g);g.connect(a.destination);o.frequency.value=i===0?440:330;g.gain.setValueAtTime(0.3,a.currentTime+t);g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+t+0.18);o.start(a.currentTime+t);o.stop(a.currentTime+t+0.18);});}catch{}},
  paid:()=>{try{const a=new(window.AudioContext||window.webkitAudioContext)();[523,659,784,1047].forEach((f,i)=>{const o=a.createOscillator();const g=a.createGain();o.connect(g);g.connect(a.destination);o.frequency.value=f;g.gain.setValueAtTime(0.25,a.currentTime+i*0.1);g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+i*0.1+0.15);o.start(a.currentTime+i*0.1);o.stop(a.currentTime+i*0.1+0.15);});}catch{}},
};

// ═══════════════════════════════════
// PDF ARCHIVE UTILITY
// ═══════════════════════════════════
const savePdfArchive=(order,settings)=>{
  try{
    const CUR=settings?.currency||"ل.س";
    const cafeName=settings?.cafeName||"Nardeen Caffe";
    const isDebt=!!order.debtName;
    const html=`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8">
      <style>body{font-family:sans-serif;padding:20px;direction:rtl;max-width:320px;margin:0 auto}
      h2{color:#c62828;text-align:center;margin:0 0 4px}
      .sub{text-align:center;font-size:12px;color:#666;margin-bottom:12px}
      .row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}
      .total{border-top:2px solid #333;font-weight:900;font-size:15px;margin-top:8px;padding-top:8px}
      .badge{background:#c62828;color:#fff;border-radius:4px;padding:2px 8px;font-size:11px}
      .debt-badge{background:#6a1b9a;color:#fff;border-radius:4px;padding:2px 8px;font-size:11px}
      </style></head><body>
      <h2>☕ ${cafeName}</h2>
      <div class="sub">${settings?.signature||""}</div>
      <div class="sub">${new Date(order.createdAt||Date.now()).toLocaleString("ar-SY")}</div>
      <div class="row"><span>رقم الطلب:</span><span class="badge">#${order.orderNum||order.id}</span></div>
      <div class="row"><span>الزبون:</span><span style="font-weight:900;color:#1565c0">${order.debtName||order.customerName||""}</span></div>
      ${order.table?`<div class="row"><span>الطاولة:</span><span>🪑 ${order.table}</span></div>`:""}
      ${isDebt?`<div class="row"><span>نوع الدفع:</span><span class="debt-badge">💳 استيفاء دين</span></div>`:""}
      <hr/>
      ${(order.items||[]).map(i=>`<div class="row"><span>${i.emoji||""} ${i.itemName||i.name} ×${i.qty}</span><span>${((i.price||0)*(i.qty||1)).toLocaleString()} ${CUR}</span></div>`).join("")}
      ${order.discount?`<div class="row" style="color:#2e7d32"><span>خصم ${order.discount}%</span><span>-${Math.round((order.originalTotal||order.total)*order.discount/100).toLocaleString()} ${CUR}</span></div>`:""}
      <div class="row total"><span>الإجمالي</span><span style="color:#c62828">${(order.total||0).toLocaleString()} ${CUR}</span></div>
      ${order.paidBy?`<div style="margin-top:8px;font-size:11px;color:#666">💰 استلمه: ${order.paidByName||order.paidBy}</div>`:""}
      ${order.notes?`<div style="margin-top:4px;font-size:11px;color:#666">📝 ${order.notes}</div>`:""}
      <div style="text-align:center;margin-top:16px;font-size:11px;color:#999">شكراً لزيارتكم ☕</div>
      </body></html>`;
    const archived=JSON.parse(localStorage.getItem("nc_pdf_archive")||"[]");
    const entry={
      id:order.id,orderNum:order.orderNum||order.id,
      customerName:order.debtName||order.customerName,
      table:order.table,total:order.total,
      createdAt:order.createdAt||new Date().toISOString(),
      isDebt,html,paidByName:order.paidByName||order.paidBy||""
    };
    archived.unshift(entry);
    if(archived.length>300) archived.splice(300);
    localStorage.setItem("nc_pdf_archive",JSON.stringify(archived));
  }catch(e){console.error("pdf archive:",e);}
};

const openPdfArchive=(html)=>{
  const w=window.open("","_blank","width=420,height=620");
  if(w){w.document.write(html);w.document.close();}
};

// ═══════════════════════════════════
// ERROR BOUNDARY
// ═══════════════════════════════════
class ErrorBoundary extends React.Component{
  constructor(p){super(p);this.state={error:null};}
  static getDerivedStateFromError(e){return{error:e};}
  componentDidCatch(e,i){console.error("Boundary caught:",e,i);}
  render(){
    if(this.state.error){
      return(
        <div style={{padding:24,textAlign:"center",color:"var(--text)"}}>
          <div style={{fontSize:48,marginBottom:12}}>⚠️</div>
          <h2 style={{marginBottom:8,color:"#c62828"}}>حدث خطأ في هذه الصفحة</h2>
          <p style={{color:"var(--sub)",marginBottom:16,fontSize:13}}>{this.state.error?.message}</p>
          <button onClick={()=>this.setState({error:null})}
            style={{background:"#c62828",color:"#fff",border:"none",borderRadius:12,
              padding:"10px 24px",fontWeight:700,cursor:"pointer"}}>
            🔄 إعادة المحاولة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Toast({toast}){
  if(!toast) return null;
  const cfg={
    success:{bg:"#2e7d32",icon:"✓"},
    error:{bg:"#c62828",icon:"✗"},
    warn:{bg:"#e65100",icon:"⚠"},
    order:{bg:"#1565c0",icon:"📋"},
    paid:{bg:"#2e7d32",icon:"💰"},
    debt:{bg:"#6a1b9a",icon:"💳"},
  };
  const c=cfg[toast.type]||cfg.success;
  return(
    <div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",zIndex:9999,
      background:c.bg,color:"#fff",padding:"14px 28px",borderRadius:40,fontWeight:700,
      boxShadow:"0 8px 32px rgba(0,0,0,.35)",fontSize:15,whiteSpace:"nowrap",
      animation:"fadeIn .3s ease",display:"flex",alignItems:"center",gap:8}}>
      <span style={{fontSize:18}}>{c.icon}</span>
      {toast.msg}
    </div>
  );
}

// ═══════════════════════════════════
// PWA INSTALL BANNER
// ═══════════════════════════════════
function PWABanner(){
  const [prompt,setPrompt]=useState(null);
  const [show,setShow]=useState(false);
  useEffect(()=>{
    const h=(e)=>{e.preventDefault();setPrompt(e);setShow(true)};
    window.addEventListener("beforeinstallprompt",h);
    return()=>window.removeEventListener("beforeinstallprompt",h);
  },[]);
  if(!show) return null;
  return(
    <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",zIndex:8888,
      background:"#1a1a2e",color:"#fff",borderRadius:16,padding:"14px 20px",
      display:"flex",alignItems:"center",gap:12,boxShadow:"0 8px 32px rgba(0,0,0,.4)",
      maxWidth:340,width:"90%"}}>
      <span style={{fontSize:28}}>📱</span>
      <div style={{flex:1}}>
        <div style={{fontWeight:800,fontSize:13}}>تثبيت التطبيق</div>
        <div style={{fontSize:11,color:"#aaa",marginTop:2}}>أضف ناردين كافيه لشاشتك الرئيسية</div>
      </div>
      <button onClick={async()=>{prompt.prompt();await prompt.userChoice;setPrompt(null);setShow(false)}}
        style={{background:"#c62828",color:"#fff",border:"none",borderRadius:10,padding:"8px 14px",fontWeight:800,fontSize:12}}>
        تثبيت
      </button>
      <button onClick={()=>setShow(false)}
        style={{background:"none",border:"none",color:"#aaa",fontSize:18,padding:4}}>✕</button>
    </div>
  );
}

// ═══════════════════════════════════
// MAIN APP
// ═══════════════════════════════════
export default function NardeenCaffe(){
  const store = useStore();
  // ── FIX 1: حفظ المستخدم في sessionStorage لمنع تسجيل الخروج عند التحديث ──
  const [user,setUser]=useState(()=>{
    try{const s=sessionStorage.getItem("nc_session");return s?JSON.parse(s):null;}catch{return null;}
  });
  const [screen,setScreen]=useState(()=>{
    try{const s=sessionStorage.getItem("nc_session");return s?"home":"login";}catch{return "login";}
  });
  const [toast,setToast]=useState(null);
  const [dm,setDm]=useState(()=>localStorage.getItem("nc_dark")==="1");
  const prevLen=useRef(store.orders.length);

  useEffect(()=>{
    if(store.orders.length>prevLen.current&&user) playOrderAlert();
    prevLen.current=store.orders.length;
  },[store.orders.length,user]);

  const showToast=useCallback((msg,type="success")=>{
    setToast({msg,type,id:Date.now()});
    setTimeout(()=>setToast(null),3800);
    try{if(store.settings?.notifSound!==false&&SOUNDS[type]) SOUNDS[type]();}catch{}
  },[store.settings]);

  const login=(u)=>{
    const u2={...u,lastLogin:new Date().toISOString()};
    setUser(u2);setScreen("home");
    try{sessionStorage.setItem("nc_session",JSON.stringify(u2));}catch{}
  };
  const logout=()=>{
    setUser(null);setScreen("login");
    try{sessionStorage.removeItem("nc_session");}catch{}
  };

  const addNotification=useCallback((msg,targetRoles,orderId)=>{
    store.setNotifications(p=>[{
      id:Date.now().toString(),msg,targetRoles,orderId,
      createdAt:new Date().toISOString(),read:[]
    },...p.slice(0,49)]);
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
      {screen==="login"&&<LoginScreen store={store} onLogin={login} showToast={showToast} dm={dm}/>}
      {screen==="home"&&user&&(
        user.role===ROLES.CUSTOMER
          ? <CustomerPortal user={user} store={store} onLogout={logout} showToast={showToast} addNotification={addNotification} dm={dm}/>
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
function LoginScreen({store,onLogin,showToast,dm}){
  const [mode,setMode]=useState("choose"); // "choose" | "staff" | "customer"
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [showPass,setShowPass]=useState(false);
  const [error,setError]=useState("");
  const [shake,setShake]=useState(false);

  const doLogin=()=>{
    setError("");
    const u=store.users.find(x=>x.username===username&&x.password===password&&x.active);
    if(u){onLogin(u)}
    else{setError("اسم المستخدم أو كلمة المرور غير صحيحة");setShake(true);setTimeout(()=>setShake(false),600)}
  };

  const enterAsCustomer=()=>{
    let guestId=localStorage.getItem("nc_guest_id");
    if(!guestId){guestId="guest_"+Date.now();localStorage.setItem("nc_guest_id",guestId);}
    onLogin({id:guestId,username:"guest",name:"زبون",role:"customer",active:true});
  };

  const cafeName=store.settings?.cafeName||"Nardeen Caffe";
  const sig=store.settings?.signature||"بإدارة يحيى داؤود";

  return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20,
      background:dm?"#0d0d18":"linear-gradient(135deg,#1a0000 0%,#8e0000 50%,#c62828 100%)"}}>
      <style>{`
        @keyframes shakeX{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-10px)}40%,80%{transform:translateX(10px)}}
        @keyframes floatUp{0%{opacity:0;transform:translateY(30px)}100%{opacity:1;transform:translateY(0)}}
        .role-card{background:rgba(255,255,255,0.08);border:2px solid rgba(255,255,255,0.15);
          border-radius:20px;padding:28px 20px;cursor:pointer;transition:all .3s;text-align:center;
          backdrop-filter:blur(10px);}
        .role-card:hover{background:rgba(255,255,255,0.18);border-color:rgba(255,255,255,0.5);
          transform:translateY(-4px);box-shadow:0 16px 40px rgba(0,0,0,.4)}
      `}</style>
      <div style={{width:"100%",maxWidth:440,animation:"floatUp .5s ease"}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{width:100,height:100,background:"rgba(255,255,255,0.15)",
            border:"3px solid rgba(255,255,255,0.3)",
            borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:52,margin:"0 auto 16px",boxShadow:"0 12px 40px rgba(0,0,0,.5)",
            backdropFilter:"blur(10px)"}}>☕</div>
          <h1 style={{fontSize:32,fontWeight:900,color:"#fff",marginBottom:4,
            textShadow:"0 2px 12px rgba(0,0,0,.5)"}}>
            {cafeName}
          </h1>
          <p style={{fontSize:13,color:"rgba(255,255,255,0.7)"}}>{sig}</p>
        </div>

        {/* ── شاشة الاختيار ── */}
        {mode==="choose"&&(
          <div style={{animation:"floatUp .4s ease"}}>
            <p style={{textAlign:"center",color:"rgba(255,255,255,0.85)",fontSize:15,
              fontWeight:700,marginBottom:20}}>
              كيف تريد الدخول؟
            </p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
              {/* زبون */}
              <div className="role-card" onClick={enterAsCustomer}>
                <div style={{fontSize:52,marginBottom:12}}>🧑‍💼</div>
                <div style={{color:"#fff",fontWeight:900,fontSize:18,marginBottom:6}}>زبون</div>
                <div style={{color:"rgba(255,255,255,0.65)",fontSize:12}}>تصفح القائمة وأطلب مباشرة</div>
                <div style={{marginTop:14,background:"rgba(255,255,255,0.2)",borderRadius:10,
                  padding:"8px 0",color:"#fff",fontWeight:700,fontSize:13}}>
                  دخول فوري ←
                </div>
              </div>
              {/* عامل / موظف */}
              <div className="role-card" onClick={()=>setMode("staff")}>
                <div style={{fontSize:52,marginBottom:12}}>👨‍🍳</div>
                <div style={{color:"#fff",fontWeight:900,fontSize:18,marginBottom:6}}>موظف</div>
                <div style={{color:"rgba(255,255,255,0.65)",fontSize:12}}>إدارة الطلبات والعمليات</div>
                <div style={{marginTop:14,background:"rgba(255,255,255,0.2)",borderRadius:10,
                  padding:"8px 0",color:"#fff",fontWeight:700,fontSize:13}}>
                  تسجيل دخول ←
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── شاشة دخول الموظف ── */}
        {mode==="staff"&&(
          <div style={{animation:"floatUp .3s ease"}}>
            <button onClick={()=>setMode("choose")}
              style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",
                color:"#fff",borderRadius:10,padding:"6px 16px",fontSize:13,fontWeight:700,
                marginBottom:16,cursor:"pointer"}}>
              ← رجوع
            </button>
            <div style={{background:"rgba(255,255,255,0.07)",backdropFilter:"blur(14px)",
              border:"1.5px solid rgba(255,255,255,0.15)",borderRadius:20,padding:28,
              animation:shake?"shakeX .5s":"none"}}>
              <h2 style={{fontSize:18,fontWeight:900,marginBottom:20,textAlign:"center",color:"#fff"}}>
                دخول الموظفين
              </h2>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.7)",marginBottom:6,display:"block"}}>
                  اسم المستخدم
                </label>
                <input className="input" type="text" value={username}
                  onChange={e=>setUsername(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()}
                  placeholder="أدخل اسم المستخدم" autoComplete="username"
                  style={{background:"rgba(255,255,255,0.1)",color:"#fff",border:"1.5px solid rgba(255,255,255,0.2)"}}/>
              </div>
              <div style={{marginBottom:20}}>
                <label style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.7)",marginBottom:6,display:"block"}}>
                  كلمة المرور
                </label>
                <div style={{position:"relative"}}>
                  <input className="input" type={showPass?"text":"password"} value={password}
                    onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()}
                    placeholder="أدخل كلمة المرور" autoComplete="current-password"
                    style={{background:"rgba(255,255,255,0.1)",color:"#fff",border:"1.5px solid rgba(255,255,255,0.2)"}}/>
                  <button onClick={()=>setShowPass(p=>!p)}
                    style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",
                      background:"none",border:"none",fontSize:16,color:"rgba(255,255,255,0.6)",padding:0}}>
                    {showPass?"🙈":"👁"}
                  </button>
                </div>
              </div>
              {error&&<div style={{background:"rgba(198,40,40,0.4)",color:"#ffcdd2",borderRadius:10,
                padding:"10px 14px",fontSize:13,marginBottom:14,fontWeight:600,
                border:"1px solid rgba(198,40,40,0.5)"}}>⚠ {error}</div>}
              <button className="btn btn-red" onClick={doLogin} style={{width:"100%",padding:13,fontSize:15}}>
                دخول ☕
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════
// CUSTOMER PORTAL — واجهة الزبون المنفصلة
// ═══════════════════════════════════
// ── FIX 3: Customer Landing Page ──────────────────────────────────────────────
function CustomerLanding({store,onEnter,onLogout,dm}){
  const settings=store.settings||{};
  const CUR=settings.currency||"ل.س";
  const [activeSlide,setActiveSlide]=useState(0);

  const showcaseCategories=[
    {key:"hot_drinks",  label:"مشروبات ساخنة",  emoji:"☕", grad:"linear-gradient(135deg,#4e1a00,#8b3a00,#c8692a)", tag:"دفء وراحة"},
    {key:"cold_drinks", label:"مشروبات باردة",   emoji:"🧊", grad:"linear-gradient(135deg,#003366,#0066cc,#00aaff)", tag:"منعش ولذيذ"},
    {key:"food",        label:"أكل ووجبات خفيفة",emoji:"🍔", grad:"linear-gradient(135deg,#1a3300,#2e7d32,#66bb6a)", tag:"شهي وطازج"},
    {key:"hookah",      label:"نرجيلة وأراكيل",  emoji:"💨", grad:"linear-gradient(135deg,#2d0057,#6a1b9a,#ab47bc)", tag:"تجربة استثنائية"},
  ];

  const topItems=(catKey)=>store.menu.filter(m=>m.category===catKey&&m.stock>0).slice(0,4);

  return(
    <div style={{minHeight:"100vh",background:"#0d0d18",direction:"rtl",overflowX:"hidden"}}>
      <style>{`
        @keyframes landFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes landFadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        .cat-pill:hover{transform:scale(1.06)!important;filter:brightness(1.15)}
        .item-tile:hover{transform:translateY(-5px) scale(1.03)!important;box-shadow:0 16px 40px rgba(0,0,0,.5)!important}
        .next-btn{background:linear-gradient(135deg,#c62828,#8e0000);border:none;border-radius:50px;
          padding:16px 40px;font-size:18px;font-weight:900;color:#fff;cursor:pointer;
          box-shadow:0 8px 30px rgba(198,40,40,.5);transition:all .3s;font-family:inherit}
        .next-btn:hover{transform:translateY(-3px);box-shadow:0 14px 40px rgba(198,40,40,.7)}
      `}</style>
      <div style={{background:"linear-gradient(160deg,#1a0000 0%,#8e0000 60%,#c62828 100%)",
        padding:"50px 20px 60px",textAlign:"center",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-60,right:-60,width:250,height:250,
          background:"rgba(255,255,255,0.05)",borderRadius:"50%"}}/>
        <div style={{position:"absolute",bottom:-80,left:-40,width:200,height:200,
          background:"rgba(255,255,255,0.04)",borderRadius:"50%"}}/>
        <div style={{fontSize:72,animation:"landFloat 3s ease-in-out infinite",marginBottom:12}}>☕</div>
        <h1 style={{color:"#fff",fontSize:30,fontWeight:900,marginBottom:6,animation:"landFadeIn .6s ease"}}>
          {settings.cafeName||"Nardeen Caffe"}
        </h1>
        <p style={{color:"rgba(255,255,255,0.75)",fontSize:14,marginBottom:0,animation:"landFadeIn .8s ease"}}>
          {settings.signature||"بإدارة يحيى داؤود"}
        </p>
        <p style={{color:"rgba(255,255,255,0.5)",fontSize:12,marginTop:6}}>اختر من قائمتنا الشهية ✨</p>
      </div>
      <div style={{padding:"24px 16px",maxWidth:800,margin:"0 auto"}}>
        <div style={{display:"flex",gap:10,overflowX:"auto",marginBottom:28,paddingBottom:4}} className="scroll-hide">
          {showcaseCategories.map((c,i)=>(
            <button key={c.key} className="cat-pill" onClick={()=>setActiveSlide(i)}
              style={{flexShrink:0,background:activeSlide===i?c.grad:"rgba(255,255,255,0.08)",
                border:activeSlide===i?"2px solid rgba(255,255,255,0.5)":"2px solid rgba(255,255,255,0.1)",
                color:"#fff",borderRadius:50,padding:"10px 18px",fontSize:13,fontWeight:700,
                cursor:"pointer",transition:"all .3s",whiteSpace:"nowrap",fontFamily:"inherit"}}>
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
        {showcaseCategories.map((cat,idx)=>(
          activeSlide===idx&&(
            <div key={cat.key} style={{animation:"landFadeIn .4s ease"}}>
              <div style={{background:cat.grad,borderRadius:20,padding:"20px 20px 16px",
                marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between",
                boxShadow:"0 8px 30px rgba(0,0,0,.4)"}}>
                <div>
                  <div style={{fontSize:40,marginBottom:4}}>{cat.emoji}</div>
                  <div style={{color:"#fff",fontWeight:900,fontSize:20}}>{cat.label}</div>
                  <div style={{color:"rgba(255,255,255,0.75)",fontSize:12,marginTop:2}}>✦ {cat.tag}</div>
                </div>
                <div style={{textAlign:"center",background:"rgba(255,255,255,0.15)",borderRadius:14,padding:"10px 16px"}}>
                  <div style={{color:"#fff",fontSize:11,opacity:.8}}>عدد الأصناف</div>
                  <div style={{color:"#fff",fontWeight:900,fontSize:24}}>
                    {store.menu.filter(m=>m.category===cat.key&&m.stock>0).length}
                  </div>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:14,marginBottom:28}}>
                {topItems(cat.key).map(item=>(
                  <div key={item.id} className="item-tile"
                    style={{background:"rgba(255,255,255,0.07)",border:"1.5px solid rgba(255,255,255,0.12)",
                      borderRadius:16,padding:"16px 12px",textAlign:"center",transition:"all .3s",
                      boxShadow:"0 4px 16px rgba(0,0,0,.3)"}}>
                    <div style={{fontSize:40,marginBottom:8}}>{item.emoji}</div>
                    <div style={{color:"#fff",fontWeight:700,fontSize:13,marginBottom:6,lineHeight:1.3}}>{item.name}</div>
                    <div style={{color:"#ff8a80",fontWeight:900,fontSize:14}}>{item.price.toLocaleString()} {CUR}</div>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:32}}>
                {showcaseCategories.map((_,i)=>(
                  <button key={i} onClick={()=>setActiveSlide(i)}
                    style={{width:i===idx?28:10,height:10,borderRadius:10,border:"none",
                      background:i===idx?"#c62828":"rgba(255,255,255,0.2)",transition:"all .3s",cursor:"pointer"}}/>
                ))}
              </div>
            </div>
          )
        ))}
        <div style={{textAlign:"center",padding:"0 0 40px"}}>
          <div style={{color:"rgba(255,255,255,0.6)",fontSize:13,marginBottom:20}}>جاهز للطلب؟ اكتشف القائمة الكاملة</div>
          <button className="next-btn" onClick={onEnter}>ابدأ طلبك الآن ←</button>
          <div style={{marginTop:24}}>
            <button onClick={onLogout}
              style={{background:"none",border:"1px solid rgba(255,255,255,0.2)",color:"rgba(255,255,255,0.5)",
                borderRadius:10,padding:"8px 20px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
              خروج
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomerPortal({user,store,onLogout,showToast,addNotification,dm}){
  const [phase,setPhase]=useState("landing");
  const [tab,setTab]=useState("menu");
  const [cart,setCart]=useState([]);
  const [search,setSearch]=useState("");
  const [cat,setCat]=useState("all");
  const [notes,setNotes]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const [showConfirm,setShowConfirm]=useState(false);
  const [tableInput,setTableInput]=useState("");
  const [codeInput,setCodeInput]=useState("");
  const [codeError,setCodeError]=useState("");
  const settings=store.settings||{};
  const CUR=settings.currency||"ل.س";
  const lang=settings.appLang||"ar";
  const T=lang==="en"?{
    tableLabel:"Table Number",tablePh:"e.g. 5",
    codeLabel:"Cashier Code",codePh:"Enter code",
    codeErr:"❌ Wrong code — ask the cashier",
    tableErr:"Please enter table number",
    sending:"Sending…",confirm:"✓ Confirm & Send",
    cancel:"Cancel",confirmTitle:"Confirm Order",
    confirmNote:"Enter your table number and cashier code.",
  }:{
    tableLabel:"رقم الطاولة",tablePh:"مثال: 5",
    codeLabel:"رمز الكاشير",codePh:"أدخل الرمز",
    codeErr:"❌ الرمز غير صحيح — اسأل الكاشير",
    tableErr:"يرجى إدخال رقم الطاولة",
    sending:"⏳ جاري الإرسال...",confirm:"✓ تأكيد وإرسال الطلب",
    cancel:"إلغاء",confirmTitle:"تأكيد الطلب",
    confirmNote:"أدخل رقم طاولتك ورمز الكاشير لإتمام الطلب.",
  };
  const SECRET=(settings.cashierCode||"narden").toLowerCase();

  if(phase==="landing"){
    return <CustomerLanding store={store} onEnter={()=>setPhase("ordering")} onLogout={onLogout} dm={dm}/>;
  }

  const filtered=store.menu.filter(m=>{
    const ms=m.name.toLowerCase().includes(search.toLowerCase());
    const mc=cat==="all"||m.category===cat;
    return ms&&mc&&m.stock>0;
  });

  const addToCart=(item)=>setCart(p=>{
    const ex=p.find(c=>c.itemId===item.id);
    if(ex) return p.map(c=>c.itemId===item.id?{...c,qty:c.qty+1}:c);
    return [...p,{itemId:item.id,itemName:item.name,price:item.price,qty:1,emoji:item.emoji}];
  });
  const removeFromCart=(id)=>setCart(p=>{
    const ex=p.find(c=>c.itemId===id);
    if(ex&&ex.qty>1) return p.map(c=>c.itemId===id?{...c,qty:c.qty-1}:c);
    return p.filter(c=>c.itemId!==id);
  });
  const cartTotal=cart.reduce((s,c)=>s+c.price*c.qty,0);
  const cartCount=cart.reduce((s,c)=>s+c.qty,0);

  const openConfirm=()=>{
    if(!cart.length){showToast("السلة فارغة","error");return;}
    setTableInput("");setCodeInput("");setCodeError("");setShowConfirm(true);
  };

  const placeOrder=()=>{
    setCodeError("");
    if(!tableInput.trim()){setCodeError(T.tableErr);return;}
    if(codeInput.trim().toLowerCase()!==SECRET){setCodeError(T.codeErr);return;}
    setSubmitting(true);
    setTimeout(()=>{
      const orderNum=(store.orders.length+1).toString().padStart(4,"0");
      const newOrder={
        id:Date.now().toString(),orderNum,
        customerId:user.id,customerName:user.name,
        table:tableInput.trim(),notes,items:cart,total:cartTotal,discount:0,
        status:ORDER_STATUS.PENDING,createdAt:new Date().toISOString(),paymentStatus:"pending"
      };
      store.setOrders(p=>[newOrder,...p]);
      store.setMenu(p=>p.map(m=>{
        const ci=cart.find(c=>c.itemId===m.id);
        if(!ci) return m;
        return{...m,stock:Math.max(0,m.stock-ci.qty),totalSold:m.totalSold+ci.qty};
      }));
      const hasDrinks=cart.some(c=>["hot_drinks","cold_drinks"].includes(store.menu.find(m=>m.id===c.itemId)?.category));
      const hasHookah=cart.some(c=>store.menu.find(m=>m.id===c.itemId)?.category==="hookah");
      if(hasDrinks) addNotification(`🍹 طلب زبون #${orderNum} للبار`,[ROLES.BAR],newOrder.id);
      if(hasHookah) addNotification(`💨 طلب نرجيلة #${orderNum}`,[ROLES.HOOKAH],newOrder.id);
      addNotification(`📋 طلب جديد #${orderNum} من ${user.name} • طاولة ${tableInput.trim()}`,[ROLES.CASHIER,ROLES.ADMIN],newOrder.id);
      setCart([]);setNotes("");setSubmitting(false);setShowConfirm(false);
      setTableInput("");setCodeInput("");
      showToast(`✓ تم إرسال طلبك #${orderNum}`);
      setTab("myorders");
    },700);
  };

  const myOrders=store.orders.filter(o=>o.customerId===user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));

  return(
    <div style={{minHeight:"100vh",background:"var(--bg)"}}>
      {/* Customer Header */}
      <header style={{background:"linear-gradient(135deg,#8e0000,#c62828)",color:"#fff",
        padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",
        position:"sticky",top:0,zIndex:100,boxShadow:"0 4px 20px rgba(198,40,40,.3)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:24}}>☕</span>
          <div>
            <div style={{fontWeight:900,fontSize:16}}>{settings.cafeName||"Nardeen Caffe"}</div>
            <div style={{fontSize:10,opacity:.8}}>مرحباً {user.name} 👋</div>
          </div>
        </div>
        <button onClick={onLogout} style={{background:"rgba(255,255,255,.2)",border:"none",
          color:"#fff",borderRadius:10,padding:"6px 14px",fontWeight:700,fontSize:13}}>
          خروج
        </button>
      </header>

      {/* Customer Nav */}
      <nav style={{background:"var(--card)",borderBottom:"2px solid var(--border)",
        display:"flex",padding:"0 16px"}} className="scroll-hide">
        {[["menu","🍽","قائمة الطعام"],["cart","🛒",`السلة${cartCount>0?` (${cartCount})`:""}`,],["myorders","📦","طلباتي"]].map(([t,icon,label])=>(
          <button key={t} onClick={()=>setTab(t)} style={{padding:"14px 16px",border:"none",
            background:"none",fontWeight:tab===t?800:500,color:tab===t?"#c62828":"var(--sub)",
            fontSize:13,borderBottom:tab===t?"3px solid #c62828":"3px solid transparent",
            whiteSpace:"nowrap",transition:"all .2s"}}>
            {icon} {label}
          </button>
        ))}
      </nav>

      <main style={{padding:16,maxWidth:900,margin:"0 auto"}}>
        {/* Menu tab */}
        {tab==="menu"&&(
          <div className="fade-in">
            <div style={{marginBottom:16}}>
              <input className="input" placeholder="🔍 ابحث عن صنف..." value={search} onChange={e=>setSearch(e.target.value)} style={{marginBottom:12}}/>
              <div style={{display:"flex",gap:8,overflowX:"auto"}} className="scroll-hide">
                <button onClick={()=>setCat("all")} style={{padding:"7px 16px",borderRadius:20,border:"none",
                  background:cat==="all"?"#c62828":"var(--card2)",color:cat==="all"?"#fff":"var(--sub)",
                  fontWeight:700,fontSize:12,whiteSpace:"nowrap",boxShadow:"var(--shadow)"}}>
                  🍽 الكل
                </button>
                {CAT_ORDER.map(c=>(
                  <button key={c} onClick={()=>setCat(c)} style={{padding:"7px 16px",borderRadius:20,border:"none",
                    background:cat===c?"#c62828":"var(--card2)",color:cat===c?"#fff":"var(--sub)",
                    fontWeight:700,fontSize:12,whiteSpace:"nowrap",boxShadow:"var(--shadow)"}}>
                    {CAT_LABELS[c]}
                  </button>
                ))}
              </div>
            </div>

            {/* Grouped by category */}
            {(cat==="all"?CAT_ORDER:[cat]).map(catKey=>{
              const items=filtered.filter(m=>m.category===catKey);
              if(!items.length) return null;
              return(
                <div key={catKey} style={{marginBottom:24}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                    <div style={{width:4,height:20,background:"#c62828",borderRadius:4}}/>
                    <h3 style={{fontSize:16,fontWeight:800}}>{CAT_LABELS[catKey]}</h3>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:12}}>
                    {items.map(item=>{
                      const inCart=cart.find(c=>c.itemId===item.id);
                      return(
                        <div key={item.id} onClick={()=>addToCart(item)}
                          style={{background:"var(--card)",borderRadius:14,padding:14,cursor:"pointer",
                            transition:"all .2s",boxShadow:inCart?"0 0 0 2.5px #c62828,var(--shadow)":"var(--shadow)",
                            transform:inCart?"scale(1.03)":"scale(1)",position:"relative",userSelect:"none"}}>
                          <div style={{fontSize:32,textAlign:"center",marginBottom:8}}>{item.emoji}</div>
                          <div style={{fontSize:13,fontWeight:700,textAlign:"center",marginBottom:4}}>{item.name}</div>
                          <div style={{fontSize:13,fontWeight:900,color:"#c62828",textAlign:"center"}}>
                            {item.price.toLocaleString()} {CUR}
                          </div>
                          {inCart&&(
                            <div style={{position:"absolute",top:8,left:8,background:"#c62828",color:"#fff",
                              borderRadius:"50%",width:22,height:22,fontSize:12,fontWeight:900,
                              display:"flex",alignItems:"center",justifyContent:"center"}}>
                              {inCart.qty}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Cart tab */}
        {tab==="cart"&&(
          <div className="fade-in">
            <h2 style={{fontSize:20,fontWeight:900,marginBottom:16}}>🛒 سلة الطلبات</h2>
            {!cart.length?(
              <div style={{textAlign:"center",padding:60,color:"var(--sub)"}}>
                <div style={{fontSize:56,marginBottom:12}}>🛒</div>
                <div>السلة فارغة — تصفح القائمة وأضف ما تشتهيه</div>
                <button className="btn btn-red" onClick={()=>setTab("menu")} style={{marginTop:16}}>
                  تصفح القائمة
                </button>
              </div>
            ):(
              <>
                {cart.map(item=>(
                  <div key={item.itemId} className="card" style={{marginBottom:10,display:"flex",alignItems:"center",gap:12}}>
                    <span style={{fontSize:26}}>{item.emoji}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:14}}>{item.itemName}</div>
                      <div style={{fontSize:12,color:"#c62828",fontWeight:700}}>
                        {(item.price*item.qty).toLocaleString()} {CUR}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10,background:"var(--card2)",
                      borderRadius:20,padding:"4px 12px"}}>
                      <button onClick={()=>removeFromCart(item.itemId)} style={{background:"none",border:"none",
                        fontSize:18,color:"#c62828",fontWeight:900,lineHeight:1}}>−</button>
                      <span style={{fontWeight:900,fontSize:16,minWidth:24,textAlign:"center"}}>{item.qty}</span>
                      <button onClick={()=>addToCart(store.menu.find(m=>m.id===item.itemId))} style={{background:"none",border:"none",
                        fontSize:18,color:"#2e7d32",fontWeight:900,lineHeight:1}}>+</button>
                    </div>
                  </div>
                ))}
                <div className="card" style={{marginTop:16}}>
                  <textarea className="input" placeholder="📝 ملاحظات خاصة (اختياري)..."
                    value={notes} onChange={e=>setNotes(e.target.value)} style={{resize:"none",height:70,marginBottom:14}}/>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:16,fontWeight:900,marginBottom:14}}>
                    <span>الإجمالي</span>
                    <span style={{color:"#c62828"}}>{cartTotal.toLocaleString()} {CUR}</span>
                  </div>
                  <div style={{background:"var(--card2)",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"var(--sub)"}}>
                    💡 سيتم الدفع عند استلام طلبك من الموظف
                  </div>
                  <button className="btn btn-red" onClick={openConfirm} disabled={submitting}
                    style={{width:"100%",padding:14,fontSize:16}}>
                    {submitting?T.sending:"✓ إرسال الطلب"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* My Orders */}
        {tab==="myorders"&&(
          <div className="fade-in">
            <h2 style={{fontSize:20,fontWeight:900,marginBottom:16}}>📦 طلباتي</h2>
            {!myOrders.length?(
              <div style={{textAlign:"center",padding:60,color:"var(--sub)"}}>
                <div style={{fontSize:56}}>📦</div>
                <div style={{marginTop:12}}>لا توجد طلبات بعد</div>
              </div>
            ):myOrders.map(order=>(
              <div key={order.id} className="card" style={{marginBottom:12,borderRight:`4px solid ${STATUS_COLORS[order.status]}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontWeight:900,fontSize:15}}>طلب #{order.orderNum}</span>
                  <span className={`badge s-${order.status}`}>{STATUS_LABELS[order.status]}</span>
                </div>
                <div style={{fontSize:12,color:"var(--sub)",marginBottom:8}}>
                  {new Date(order.createdAt).toLocaleString("ar-SY")}
                </div>
                {order.items.map((i,idx)=>(
                  <div key={idx} style={{fontSize:13,padding:"2px 0"}}>
                    {i.emoji} {i.itemName} ×{i.qty} — {(i.price*i.qty).toLocaleString()} {CUR}
                  </div>
                ))}
                <div style={{fontWeight:900,color:"#c62828",marginTop:8}}>
                  الإجمالي: {order.total.toLocaleString()} {CUR}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── نافذة تأكيد الطلب ── */}
      {showConfirm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:999,
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={e=>{if(e.target===e.currentTarget)setShowConfirm(false);}}>
          <div style={{background:"var(--card)",borderRadius:20,padding:28,width:"100%",maxWidth:380,
            boxShadow:"0 24px 60px rgba(0,0,0,.5)"}}>
            <div style={{textAlign:"center",marginBottom:18}}>
              <div style={{fontSize:44,marginBottom:6}}>🧾</div>
              <h2 style={{fontSize:18,fontWeight:900,marginBottom:6}}>{T.confirmTitle}</h2>
              <p style={{fontSize:13,color:"var(--sub)",lineHeight:1.6}}>{T.confirmNote}</p>
            </div>
            {/* ملخص السلة */}
            <div style={{background:"var(--card2)",borderRadius:12,padding:"10px 14px",
              marginBottom:14,maxHeight:110,overflowY:"auto"}}>
              {cart.map((c,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",
                  fontSize:12,padding:"3px 0",
                  borderBottom:i<cart.length-1?"1px solid var(--border)":"none"}}>
                  <span>{c.emoji} {c.itemName} ×{c.qty}</span>
                  <span style={{fontWeight:700,color:"#c62828"}}>
                    {(c.price*c.qty).toLocaleString()} {CUR}
                  </span>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",
                fontWeight:900,marginTop:8,fontSize:13,color:"#c62828"}}>
                <span>{lang==="en"?"Total":"الإجمالي"}</span>
                <span>{cartTotal.toLocaleString()} {CUR}</span>
              </div>
            </div>
            {/* رقم الطاولة */}
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",
                marginBottom:6,display:"block"}}>🪑 {T.tableLabel}</label>
              <input className="input" placeholder={T.tablePh} value={tableInput}
                onChange={e=>{setTableInput(e.target.value);setCodeError("");}}
                style={{textAlign:"center",fontSize:20,fontWeight:900,letterSpacing:3}}/>
            </div>
            {/* رمز الكاشير */}
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",
                marginBottom:6,display:"block"}}>🔑 {T.codeLabel}</label>
              <input className="input" type="password" placeholder={T.codePh}
                value={codeInput}
                onChange={e=>{setCodeInput(e.target.value);setCodeError("");}}
                onKeyDown={e=>e.key==="Enter"&&placeOrder()}
                style={{textAlign:"center",fontSize:20,letterSpacing:5}}/>
            </div>
            {/* رسالة خطأ */}
            {codeError&&(
              <div style={{background:"rgba(198,40,40,.15)",color:"#c62828",
                borderRadius:10,padding:"10px 14px",fontSize:13,fontWeight:700,
                marginBottom:14,border:"1px solid rgba(198,40,40,.3)",textAlign:"center"}}>
                {codeError}
              </div>
            )}
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setShowConfirm(false)}
                style={{flex:1,padding:12,borderRadius:12,
                  border:"1.5px solid var(--border)",background:"none",
                  color:"var(--text)",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                {T.cancel}
              </button>
              <button className="btn btn-red" onClick={placeOrder} disabled={submitting}
                style={{flex:2,padding:12,fontSize:14}}>
                {submitting?T.sending:T.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ═══════════════════════════════════
// HOME SCREEN (Staff)
// ═══════════════════════════════════
function HomeScreen({user,store,onLogout,showToast,addNotification,unreadCount,dm,toggleDark,settings}){
  const [tab,setTab]=useState(()=>{
    if(canAccess(user.role,"dashboard")) return "dashboard";
    if(canAccess(user.role,"order")) return "order";
    if(canAccess(user.role,"orders")) return "orders";
    if(canAccess(user.role,"bar")) return "bar";
    if(canAccess(user.role,"hookah")) return "hookah";
    return "orders";
  });
  const [showNotifs,setShowNotifs]=useState(false);
  const [clock,setClock]=useState(new Date());
  const CUR=settings?.currency||"ل.س";

  useEffect(()=>{
    const t=setInterval(()=>setClock(new Date()),1000);
    return()=>clearInterval(t);
  },[]);

  const markRead=()=>store.setNotifications(p=>p.map(n=>
    n.targetRoles.includes(user.role)&&!n.read.includes(user.id)?{...n,read:[...n.read,user.id]}:n
  ));

  const navDef=[
    ["dashboard","📊","لوحة التحكم"],
    ["order","➕","طلب جديد"],
    ["orders","📋","الطلبات"],
    ["cashier","💰","الكاشير"],
    ["debts","💳","الديون"],
    ["expenses","📒","المصاريف"],
    ["bar","🥤","البار"],
    ["hookah","💨","الأراكيل"],
    ["menu","🍽","المنيو"],
    ["tables","🪑","الطاولات"],
    ["staff","👥","الموظفون"],
    ["reports","📈","التقارير"],
    ["settings","⚙","الإعدادات"],
  ];
  const navItems=navDef.filter(([t])=>canAccess(user.role,t));

  return(
    <div style={{display:"flex",flexDirection:"column",minHeight:"100vh"}}>
      {/* Header */}
      <header style={{background:"linear-gradient(135deg,#8e0000,#c62828)",color:"#fff",
        padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",
        gap:8,position:"sticky",top:0,zIndex:100,boxShadow:"0 4px 20px rgba(198,40,40,.3)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:22}}>☕</span>
          <div>
            <div style={{fontWeight:900,fontSize:14}}>{settings?.cafeName||"Nardeen Caffe"}</div>
            <div style={{fontSize:10,opacity:.8}}>{settings?.signature||"بإدارة يحيى داؤود"}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
          {SUPABASE_READY?(
            <span className="hide-mobile" style={{fontSize:10,background:"rgba(46,125,50,.3)",borderRadius:8,
              padding:"3px 8px",color:"#a5d6a7",fontWeight:700}}>
              {store.syncing?"🔄 تزامن...":"☁ متصل"}
            </span>
          ):(
            <span className="hide-mobile" style={{fontSize:10,background:"rgba(249,168,37,.25)",
              borderRadius:8,padding:"3px 8px",color:"#ffe082",fontWeight:700}}>💾 محلي</span>
          )}
          <span className="hide-mobile" style={{fontSize:12,background:"rgba(255,255,255,.15)",
            borderRadius:8,padding:"4px 10px",fontWeight:700}}>
            {clock.toLocaleTimeString("ar-SY",{hour:"2-digit",minute:"2-digit"})}
          </span>
          <button onClick={toggleDark} style={{background:"rgba(255,255,255,.15)",border:"none",
            color:"#fff",borderRadius:10,padding:"6px 10px",fontSize:14}}>
            {dm?"☀":"🌙"}
          </button>
          {/* Notifications */}
          <div style={{position:"relative"}}>
            <button onClick={()=>{setShowNotifs(s=>!s);markRead()}}
              style={{background:"rgba(255,255,255,.2)",border:"none",color:"#fff",borderRadius:10,
                padding:"6px 10px",fontSize:16,position:"relative"}}>
              🔔
              {unreadCount>0&&(
                <span style={{position:"absolute",top:-4,right:-4,background:"#f9a825",color:"#333",
                  borderRadius:"50%",width:18,height:18,fontSize:10,fontWeight:900,
                  display:"flex",alignItems:"center",justifyContent:"center"}}>{unreadCount}</span>
              )}
            </button>
            {showNotifs&&(
              <div style={{position:"absolute",top:"calc(100% + 8px)",left:0,width:280,
                background:"var(--card)",borderRadius:12,boxShadow:"var(--shadow)",
                zIndex:200,overflow:"hidden",border:"1px solid var(--border)"}}>
                <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",
                  fontWeight:800,fontSize:13}}>🔔 الإشعارات</div>
                <div style={{maxHeight:260,overflowY:"auto"}}>
                  {store.notifications.filter(n=>n.targetRoles.includes(user.role)).length===0?(
                    <div style={{padding:20,textAlign:"center",color:"var(--sub)",fontSize:13}}>لا توجد إشعارات</div>
                  ):store.notifications.filter(n=>n.targetRoles.includes(user.role)).slice(0,20).map(n=>(
                    <div key={n.id} style={{padding:"10px 16px",borderBottom:"1px solid var(--border)",
                      background:n.read.includes(user.id)?"transparent":"rgba(249,168,37,.08)"}}>
                      <div style={{fontSize:12}}>{n.msg}</div>
                      <div style={{fontSize:10,color:"var(--sub)",marginTop:3}}>
                        {new Date(n.createdAt).toLocaleString("ar-SY")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
            <span style={{fontSize:12,fontWeight:700,opacity:.9}}>{user.name}</span>
            <span style={{fontSize:10,opacity:.7}}>{ROLE_LABELS[user.role]}</span>
          </div>
          <button onClick={onLogout} style={{background:"rgba(255,255,255,.2)",border:"none",
            color:"#fff",borderRadius:10,padding:"6px 12px",fontSize:12,fontWeight:700}}>خروج</button>
        </div>
      </header>

      {/* Nav */}
      <nav style={{background:"var(--card)",borderBottom:"2px solid var(--border)",
        display:"flex",overflowX:"auto",padding:"0 8px"}} className="scroll-hide">
        {navItems.map(([t,icon,label])=>(
          <button key={t} onClick={()=>setTab(t)} style={{padding:"12px 14px",border:"none",
            background:"none",fontWeight:tab===t?800:500,color:tab===t?"#c62828":"var(--sub)",
            fontSize:13,borderBottom:tab===t?"3px solid #c62828":"3px solid transparent",
            whiteSpace:"nowrap",transition:"all .2s",display:"flex",alignItems:"center",gap:5}}>
            <span>{icon}</span>
            <span className="hide-mobile">{label}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{flex:1,padding:16,maxWidth:1280,width:"100%",margin:"0 auto"}}>
        <ErrorBoundary key={tab}>
        {tab==="dashboard"  &&canAccess(user.role,"dashboard") &&<DashboardTab   store={store} dm={dm} settings={settings} key={store.orders.length+"_"+store.orders.filter(o=>o.status==="paid").length}/>}
        {tab==="inventory"  &&canAccess(user.role,"dashboard") &&<InventoryTab   store={store} settings={settings}/>}
        {tab==="order"      &&canAccess(user.role,"order")     &&<NewOrderTab    store={store} user={user} showToast={showToast} addNotification={addNotification} dm={dm} settings={settings}/>}
        {tab==="orders"     &&canAccess(user.role,"orders")    &&<OrdersTab      store={store} user={user} showToast={showToast} addNotification={addNotification} dm={dm} settings={settings}/>}
        {tab==="cashier"    &&canAccess(user.role,"cashier")   &&<CashierTab     store={store} user={user} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="debts"      &&canAccess(user.role,"debts")     &&<DebtsTab       store={store} user={user} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="expenses"   &&canAccess(user.role,"expenses")  &&<ExpensesTab    store={store} user={user} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="bar"        &&canAccess(user.role,"bar")       &&<BarTab         store={store} user={user} showToast={showToast} addNotification={addNotification} dm={dm} settings={settings}/>}
        {tab==="hookah"     &&canAccess(user.role,"hookah")    &&<HookahTab      store={store} user={user} showToast={showToast} addNotification={addNotification} dm={dm} settings={settings}/>}
        {tab==="menu"       &&canAccess(user.role,"menu")      &&<MenuTab        store={store} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="tables"     &&canAccess(user.role,"tables")    &&<TablesTab      store={store} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="staff"      &&canAccess(user.role,"staff")     &&<StaffTab       store={store} showToast={showToast} dm={dm}/>}
        {tab==="reports"    &&canAccess(user.role,"reports")   &&<ReportsTab     store={store} dm={dm} settings={settings}/>}
        {tab==="settings"   &&canAccess(user.role,"settings")  &&<SettingsTab    store={store} showToast={showToast} dm={dm} user={user}/>}
        </ErrorBoundary>
      </main>
      <div style={{height:"env(safe-area-inset-bottom,0px)"}}/>
    </div>
  );
}

// ═══════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════
function DashboardTab({store,dm,settings}){
  const CUR=settings?.currency||"ل.س";
  const today=new Date();today.setHours(0,0,0,0);
  const todayOrders=store.orders.filter(o=>new Date(o.createdAt)>=today);
  const totalRevenue=store.orders.filter(o=>o.status==="paid").reduce((s,o)=>s+o.total,0);
  const todayPaidOrders=store.orders.filter(o=>o.status==="paid"&&new Date(o.paidAt||o.createdAt)>=today);
  const todayRevenue=todayPaidOrders.reduce((s,o)=>s+o.total,0);
  const pending=store.orders.filter(o=>o.status==="pending").length;
  const preparing=store.orders.filter(o=>o.status==="preparing").length;
  const totalDebts=store.debts.filter(d=>!d.settled).reduce((s,d)=>s+d.remaining,0);
  const todayExpenses=(store.expenses||[]).filter(e=>new Date(e.date)>=today).reduce((s,e)=>s+e.amount,0);
  const lowStock=store.menu.filter(m=>m.stock<=m.minStock);
  const topItems=store.menu.slice().sort((a,b)=>b.totalSold-a.totalSold).slice(0,5);
  const now=new Date();

  const hourly=Array.from({length:12},(_,i)=>{
    const h=now.getHours()-11+i;
    const s=new Date();s.setHours(h,0,0,0);
    const e=new Date();e.setHours(h+1,0,0,0);
    const rev=store.orders.filter(o=>o.status==="paid"&&new Date(o.paidAt||o.createdAt)>=s&&new Date(o.paidAt||o.createdAt)<e).reduce((s,o)=>s+o.total,0);
    return{h:`${h<0?24+h:h}`,rev};
  });
  const maxRev=Math.max(...hourly.map(d=>d.rev),1);

  const Stat=({icon,label,val,sub,color})=>(
    <div className="card" style={{borderTop:`4px solid ${color}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{color:"var(--sub)",fontSize:12,marginBottom:5}}>{label}</div>
          <div style={{fontSize:20,fontWeight:900,color}}>{val}</div>
          {sub&&<div style={{fontSize:11,color:"var(--sub)",marginTop:3}}>{sub}</div>}
        </div>
        <span style={{fontSize:28}}>{icon}</span>
      </div>
    </div>
  );

  return(
    <div className="fade-in">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <h2 style={{fontSize:20,fontWeight:900}}>📊 لوحة التحكم</h2>
        <span style={{fontSize:12,color:"var(--sub)"}}>
          {now.toLocaleDateString("ar-SY",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}
        </span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:18}}>
        <Stat icon="💰" label="إجمالي الإيرادات" val={`${totalRevenue.toLocaleString()} ${CUR}`} sub="كل الوقت" color="#c62828"/>
        <Stat icon="📅" label="مبيعات اليوم"    val={`${todayRevenue.toLocaleString()} ${CUR}`} sub={`${todayPaidOrders.length} طلب مدفوع`} color="#2e7d32"/>
        <Stat icon="⏳" label="طلبات معلقة"     val={pending}   sub="بحاجة معالجة" color="#f9a825"/>
        <Stat icon="👨‍🍳" label="قيد التحضير"    val={preparing} color="#1976d2"/>
        <Stat icon="💳" label="إجمالي الديون"   val={`${totalDebts.toLocaleString()} ${CUR}`} sub="غير مسدّدة" color="#6a1b9a"/>
        <Stat icon="📒" label="مصاريف اليوم"   val={`${todayExpenses.toLocaleString()} ${CUR}`} color="#e65100"/>
        <Stat icon="⚠"  label="مخزون منخفض"    val={lowStock.length} sub="صنف" color={lowStock.length>0?"#c62828":"#2e7d32"}/>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h3 style={{fontSize:14,fontWeight:800,marginBottom:12}}>📈 الإيرادات بالساعة</h3>
        <div style={{display:"flex",alignItems:"flex-end",gap:3,height:80}}>
          {hourly.map((d,i)=>(
            <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <div title={`${d.rev.toLocaleString()} ${CUR}`}
                style={{width:"100%",background:d.rev>0?"#c62828":dm?"#2a2d4a":"#eee",
                  borderRadius:"3px 3px 0 0",height:`${(d.rev/maxRev)*64+(d.rev>0?4:0)}px`,
                  minHeight:4,transition:"height .5s"}}/>
              <div style={{fontSize:8,color:"var(--sub)"}}>{d.h}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}} className="grid-2">
        <div className="card">
          <h3 style={{fontSize:14,fontWeight:800,marginBottom:12}}>🏆 أكثر المبيعات</h3>
          {topItems.filter(i=>i.totalSold>0).length===0?(
            <div style={{color:"var(--sub)",fontSize:13,textAlign:"center",padding:20}}>لا توجد بيانات بعد</div>
          ):topItems.filter(i=>i.totalSold>0).map((item,i)=>(
            <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",
              borderBottom:i<4?"1px solid var(--border)":"none"}}>
              <span style={{fontSize:18,width:26}}>{item.emoji}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600}}>{item.name}</div>
                <div style={{fontSize:11,color:"var(--sub)"}}>{item.totalSold} وحدة</div>
              </div>
              <span style={{background:"rgba(249,168,37,.2)",color:"#f9a825",borderRadius:20,
                padding:"2px 10px",fontSize:12,fontWeight:700}}>#{i+1}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3 style={{fontSize:14,fontWeight:800,marginBottom:12}}>⚠ تحذيرات المخزون</h3>
          {lowStock.length===0?(
            <div style={{color:"#2e7d32",fontSize:13,textAlign:"center",padding:20}}>✓ المخزون بحالة جيدة</div>
          ):lowStock.map((item,i)=>(
            <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",
              borderBottom:i<lowStock.length-1?"1px solid var(--border)":"none"}}>
              <span style={{fontSize:18}}>{item.emoji}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600}}>{item.name}</div>
                <div style={{height:4,background:"var(--border)",borderRadius:4,marginTop:4}}>
                  <div style={{width:`${Math.min(100,(item.stock/item.minStock)*100)}%`,
                    height:"100%",background:item.stock===0?"#c62828":"#ff9800",borderRadius:4}}/>
                </div>
              </div>
              <span style={{fontSize:13,fontWeight:700,color:item.stock===0?"#c62828":"#ff9800"}}>{item.stock}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════
// ORDER TIMER (shared component)
// ═══════════════════════════════════
// ══════════════════════════════════════
// DAILY INVENTORY TAB
// ══════════════════════════════════════
function InventoryTab({store,settings}){
  const CUR=settings?.currency||"ل.س";
  const today=new Date(); today.setHours(0,0,0,0);

  const todayPaid=store.orders.filter(o=>o.status==="paid"&&new Date(o.paidAt||o.createdAt)>=today);
  const todayRevenue=todayPaid.reduce((s,o)=>s+o.total,0);

  // مصاريف عادية (تدخل الجرد)
  const primaryExp=(store.expenses||[]).filter(e=>!e.isSecondary&&new Date(e.date)>=today);
  const primaryTotal=primaryExp.reduce((s,e)=>s+e.amount,0);

  // مصاريف ثانوية (لا تدخل الجرد)
  const secondaryExp=(store.expenses||[]).filter(e=>e.isSecondary&&new Date(e.date)>=today);
  const secondaryTotal=secondaryExp.reduce((s,e)=>s+e.amount,0);

  const net=todayRevenue-primaryTotal;

  const [showSec,setShowSec]=useState(false);

  return(
    <div className="fade-in">
      <h2 style={{fontSize:18,fontWeight:900,marginBottom:16}}>📊 الجرد اليومي</h2>

      {/* بطاقات الملخص */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:18}}>
        <div className="card" style={{borderTop:"4px solid #2e7d32",textAlign:"center"}}>
          <div style={{fontSize:22,marginBottom:4}}>💵</div>
          <div style={{fontSize:11,color:"var(--sub)"}}>الإيرادات</div>
          <div style={{fontSize:18,fontWeight:900,color:"#2e7d32"}}>{todayRevenue.toLocaleString()} {CUR}</div>
          <div style={{fontSize:11,color:"var(--sub)"}}>{todayPaid.length} طلب</div>
        </div>
        <div className="card" style={{borderTop:"4px solid #c62828",textAlign:"center"}}>
          <div style={{fontSize:22,marginBottom:4}}>📤</div>
          <div style={{fontSize:11,color:"var(--sub)"}}>المصاريف</div>
          <div style={{fontSize:18,fontWeight:900,color:"#c62828"}}>{primaryTotal.toLocaleString()} {CUR}</div>
          <div style={{fontSize:11,color:"var(--sub)"}}>{primaryExp.length} بند</div>
        </div>
        <div className="card" style={{borderTop:`4px solid ${net>=0?"#1565c0":"#e65100"}`,textAlign:"center"}}>
          <div style={{fontSize:22,marginBottom:4}}>{net>=0?"📈":"📉"}</div>
          <div style={{fontSize:11,color:"var(--sub)"}}>صافي اليوم</div>
          <div style={{fontSize:18,fontWeight:900,color:net>=0?"#1565c0":"#e65100"}}>{net.toLocaleString()} {CUR}</div>
        </div>
      </div>

      {/* تفاصيل الإيرادات */}
      <div className="card" style={{marginBottom:14}}>
        <h3 style={{fontSize:14,fontWeight:800,marginBottom:12,color:"#2e7d32"}}>✅ الطلبات المدفوعة</h3>
        {todayPaid.length===0?<p style={{color:"var(--sub)",fontSize:13}}>لا توجد طلبات مدفوعة اليوم</p>:
          todayPaid.map(o=>(
            <div key={o.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",
              borderBottom:"1px solid var(--border)",fontSize:13}}>
              <span>#{o.orderNum} — {o.customerName}</span>
              <span style={{fontWeight:700,color:"#2e7d32"}}>{o.total.toLocaleString()} {CUR}</span>
            </div>
          ))
        }
        <div style={{display:"flex",justifyContent:"space-between",fontWeight:900,
          marginTop:10,fontSize:14,color:"#2e7d32",borderTop:"2px solid #2e7d32",paddingTop:8}}>
          <span>الإجمالي</span><span>{todayRevenue.toLocaleString()} {CUR}</span>
        </div>
      </div>

      {/* تفاصيل المصاريف */}
      <div className="card" style={{marginBottom:14}}>
        <h3 style={{fontSize:14,fontWeight:800,marginBottom:12,color:"#c62828"}}>📤 المصاريف الأساسية</h3>
        {primaryExp.length===0?<p style={{color:"var(--sub)",fontSize:13}}>لا توجد مصاريف اليوم</p>:
          primaryExp.map(e=>(
            <div key={e.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",
              borderBottom:"1px solid var(--border)",fontSize:13}}>
              <span>{e.label}</span>
              <span style={{fontWeight:700,color:"#c62828"}}>{e.amount.toLocaleString()} {CUR}</span>
            </div>
          ))
        }
        <div style={{display:"flex",justifyContent:"space-between",fontWeight:900,
          marginTop:10,fontSize:14,color:"#c62828",borderTop:"2px solid #c62828",paddingTop:8}}>
          <span>الإجمالي</span><span>{primaryTotal.toLocaleString()} {CUR}</span>
        </div>
      </div>

      {/* صافي اليوم */}
      <div className="card" style={{borderTop:`4px solid ${net>=0?"#1565c0":"#e65100"}`,marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:16,fontWeight:900}}>🧾 صافي اليوم</span>
          <span style={{fontSize:22,fontWeight:900,color:net>=0?"#1565c0":"#e65100"}}>
            {net.toLocaleString()} {CUR}
          </span>
        </div>
        <div style={{fontSize:12,color:"var(--sub)",marginTop:4}}>
          {todayRevenue.toLocaleString()} إيرادات — {primaryTotal.toLocaleString()} مصاريف
        </div>
      </div>

      {/* المصاريف الثانوية */}
      <div className="card" style={{borderTop:"4px solid #f9a825"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showSec?12:0}}>
          <h3 style={{fontSize:14,fontWeight:800,color:"#f9a825"}}>⭐ المصاريف الثانوية</h3>
          <button onClick={()=>setShowSec(s=>!s)}
            style={{padding:"4px 12px",borderRadius:8,border:"none",
              background:"var(--card2)",color:"var(--text)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {showSec?"إخفاء":"عرض"} ({secondaryExp.length})
          </button>
        </div>
        {showSec&&(
          <>
            {secondaryExp.length===0?<p style={{color:"var(--sub)",fontSize:13}}>لا توجد مصاريف ثانوية اليوم</p>:
              secondaryExp.map(e=>(
                <div key={e.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",
                  borderBottom:"1px solid var(--border)",fontSize:13}}>
                  <span>{e.label}</span>
                  <span style={{fontWeight:700,color:"#f9a825"}}>{e.amount.toLocaleString()} {CUR}</span>
                </div>
              ))
            }
            <div style={{display:"flex",justifyContent:"space-between",fontWeight:900,
              marginTop:10,fontSize:14,color:"#f9a825",borderTop:"2px solid #f9a825",paddingTop:8}}>
              <span>إجمالي الثانوية</span><span>{secondaryTotal.toLocaleString()} {CUR}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OrderTimer({createdAt,dm,warnAfter=600}){
  const [elapsed,setElapsed]=useState(Math.floor((Date.now()-new Date(createdAt))/1000));
  useEffect(()=>{const t=setInterval(()=>setElapsed(e=>e+1),1000);return()=>clearInterval(t);},[]);
  const m=Math.floor(elapsed/60),s=elapsed%60;
  const isLate=elapsed>warnAfter;
  return(
    <span style={{background:isLate?"#ffebee":dm?"rgba(46,125,50,.2)":"#e8f5e9",
      color:isLate?"#c62828":"#2e7d32",borderRadius:20,padding:"2px 10px",fontSize:11,fontWeight:800}}>
      {isLate?"⚠ ":"⏱ "}{m}:{s.toString().padStart(2,"0")}
    </span>
  );
}

// ═══════════════════════════════════
// NEW ORDER TAB
// ═══════════════════════════════════
function NewOrderTab({store,user,showToast,addNotification,dm,settings}){
  const [cart,setCart]=useState([]);
  const [search,setSearch]=useState("");
  const [cat,setCat]=useState("all");
  const [tableNum,setTableNum]=useState("");
  const [notes,setNotes]=useState("");
  const [customerName,setCustomerName]=useState("");
  const [discount,setDiscount]=useState(0);
  const [submitting,setSubmitting]=useState(false);
  const CUR=settings?.currency||"ل.س";
  const maxDiscount=settings?.maxDiscount??50;
  const isAdmin=user.role===ROLES.ADMIN;

  const filtered=store.menu.filter(m=>{
    const ms=m.name.toLowerCase().includes(search.toLowerCase())||(m.nameEn||"").toLowerCase().includes(search.toLowerCase());
    const mc=cat==="all"||m.category===cat;
    return ms&&mc&&m.stock>0;
  });

  const addToCart=(item)=>setCart(p=>{
    const ex=p.find(c=>c.itemId===item.id);
    if(ex) return p.map(c=>c.itemId===item.id?{...c,qty:c.qty+1}:c);
    return [...p,{itemId:item.id,itemName:item.name,price:item.price,qty:1,emoji:item.emoji}];
  });
  const removeFromCart=(id)=>setCart(p=>{
    const ex=p.find(c=>c.itemId===id);
    if(ex&&ex.qty>1) return p.map(c=>c.itemId===id?{...c,qty:c.qty-1}:c);
    return p.filter(c=>c.itemId!==id);
  });

  const cartTotal=cart.reduce((s,c)=>s+c.price*c.qty,0);
  const cartCount=cart.reduce((s,c)=>s+c.qty,0);
  const discountAmt=Math.round(cartTotal*Math.min(discount,maxDiscount)/100);
  const finalTotal=cartTotal-discountAmt;

  const placeOrder=()=>{
    if(!cart.length){showToast("السلة فارغة","error");return}

    setSubmitting(true);
    setTimeout(()=>{
      const orderNum=(store.orders.length+1).toString().padStart(4,"0");
      const newOrder={
        id:Date.now().toString(),orderNum,
        customerId:user.id,customerName:customerName||user.name,
        workerName:user.name,table:tableNum,notes,items:cart,
        total:finalTotal,originalTotal:cartTotal,discount,
        paymentType:"cash",
        status:ORDER_STATUS.PENDING,
        createdAt:new Date().toISOString(),paymentStatus:"pending",
      };
      store.setOrders(p=>[newOrder,...p]);
      store.setMenu(p=>p.map(m=>{
        const ci=cart.find(c=>c.itemId===m.id);
        if(!ci) return m;
        return{...m,stock:Math.max(0,m.stock-ci.qty),totalSold:m.totalSold+ci.qty};
      }));

      const hasDrinks=cart.some(c=>["hot_drinks","cold_drinks"].includes(store.menu.find(m=>m.id===c.itemId)?.category));
      const hasHookah=cart.some(c=>store.menu.find(m=>m.id===c.itemId)?.category==="hookah");
      if(hasDrinks) addNotification(`🍹 طلب #${orderNum} للبار${tableNum?` • طاولة ${tableNum}`:""}`, [ROLES.BAR],newOrder.id);
      if(hasHookah) addNotification(`💨 طلب نرجيلة #${orderNum}${tableNum?` • طاولة ${tableNum}`:""}`, [ROLES.HOOKAH],newOrder.id);
      addNotification(`📋 طلب جديد #${orderNum} من ${newOrder.customerName}`,[ROLES.CASHIER,ROLES.ADMIN],newOrder.id);
      setCart([]);setTableNum("");setNotes("");setCustomerName("");setDiscount(0);
      setSubmitting(false);
      saveReceipt(newOrder,settings);
      showToast(`تم تسجيل الطلب #${orderNum} ✓`);
      if(window.confirm(`🖨️ طباعة فاتورة الطلب #${orderNum}؟`)){
        printOrder(newOrder,store.menu,1,settings);
        setTimeout(()=>printOrder(newOrder,store.menu,2,settings),800);
      }
    },800);
  };

  return(
    <div className="fade-in order-grid" style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:14,height:"calc(100vh - 130px)"}}>
      {/* Menu */}
      <div style={{display:"flex",flexDirection:"column",gap:10,overflow:"hidden"}}>
        <div className="card" style={{padding:12}}>
          <input className="input" placeholder="🔍 بحث في المنيو..." value={search} onChange={e=>setSearch(e.target.value)} style={{marginBottom:10}}/>
          <div style={{display:"flex",gap:8,overflowX:"auto"}} className="scroll-hide">
            <button onClick={()=>setCat("all")} style={{padding:"6px 14px",borderRadius:20,border:"none",
              background:cat==="all"?"#c62828":"var(--card2)",color:cat==="all"?"#fff":"var(--sub)",fontWeight:700,fontSize:12,whiteSpace:"nowrap"}}>
              🍽 الكل
            </button>
            {CAT_ORDER.map(c=>(
              <button key={c} onClick={()=>setCat(c)} style={{padding:"6px 14px",borderRadius:20,border:"none",
                background:cat===c?"#c62828":"var(--card2)",color:cat===c?"#fff":"var(--sub)",fontWeight:700,fontSize:12,whiteSpace:"nowrap"}}>
                {CAT_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(135px,1fr))",gap:8,paddingBottom:10}} className="scroll-hide">
          {filtered.map(item=>{
            const inCart=cart.find(c=>c.itemId===item.id);
            return(
              <div key={item.id} onClick={()=>addToCart(item)}
                style={{background:"var(--card)",borderRadius:12,padding:12,cursor:"pointer",
                  transition:"all .2s",boxShadow:inCart?"0 0 0 2px #c62828,var(--shadow)":"var(--shadow)",
                  transform:inCart?"scale(1.03)":"scale(1)",position:"relative",userSelect:"none"}}>
                <div style={{fontSize:26,textAlign:"center",marginBottom:5}}>{item.emoji}</div>
                <div style={{fontSize:11,fontWeight:700,textAlign:"center",marginBottom:3,lineHeight:1.3}}>{item.name}</div>
                <div style={{fontSize:11,fontWeight:900,color:"#c62828",textAlign:"center"}}>{item.price.toLocaleString()} {CUR}</div>
                <div style={{fontSize:9,color:item.stock<=item.minStock?"#ff9800":"var(--sub)",textAlign:"center",marginTop:2}}>
                  مخزون: {item.stock}
                </div>
                {inCart&&<div style={{position:"absolute",top:6,left:6,background:"#c62828",color:"#fff",
                  borderRadius:"50%",width:20,height:20,fontSize:11,fontWeight:900,
                  display:"flex",alignItems:"center",justifyContent:"center"}}>{inCart.qty}</div>}
              </div>
            );
          })}
          {filtered.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:40,color:"var(--sub)"}}>لا توجد أصناف</div>}
        </div>
      </div>

      {/* Cart */}
      <div className="order-cart" style={{background:"var(--card)",borderRadius:16,boxShadow:"var(--shadow)",
        display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"14px 14px 10px",background:"linear-gradient(135deg,#c62828,#8e0000)"}}>
          <div style={{color:"#fff",fontWeight:900,fontSize:15}}>
            🛒 السلة {cartCount>0&&<span style={{background:"rgba(255,255,255,.3)",borderRadius:20,padding:"2px 8px",fontSize:12}}>{cartCount}</span>}
          </div>
        </div>
        <div style={{padding:"10px 12px",borderBottom:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:8}}>
          <input className="input" placeholder="🪑 رقم الطاولة" value={tableNum} onChange={e=>setTableNum(e.target.value)} style={{fontSize:13}}/>
          <input className="input" placeholder="👤 اسم الزبون (اختياري)" value={customerName} onChange={e=>setCustomerName(e.target.value)} style={{fontSize:13}}/>
          <textarea className="input" placeholder="📝 ملاحظات..." value={notes} onChange={e=>setNotes(e.target.value)} style={{resize:"none",height:50,fontSize:13}}/>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <label style={{fontSize:12,color:"var(--sub)",whiteSpace:"nowrap"}}>خصم %</label>
            <input className="input" type="number" min="0" max={isAdmin?100:maxDiscount} value={discount}
              onChange={e=>setDiscount(Math.min(isAdmin?100:maxDiscount,Math.max(0,+e.target.value)))}
              style={{fontSize:13}}/>
          </div>

        </div>
        <div style={{flex:1,overflowY:"auto",padding:"8px 12px"}} className="scroll-hide">
          {!cart.length?(
            <div style={{textAlign:"center",color:"var(--sub)",paddingTop:30}}>
              <div style={{fontSize:38,marginBottom:8}}>🛒</div>
              <div style={{fontSize:12}}>اضغط على الأصناف</div>
            </div>
          ):cart.map(item=>(
            <div key={item.itemId} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:20}}>{item.emoji}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600}}>{item.itemName}</div>
                <div style={{fontSize:11,color:"#c62828",fontWeight:700}}>{(item.price*item.qty).toLocaleString()} {CUR}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,background:"var(--card2)",borderRadius:20,padding:"3px 8px"}}>
                <button onClick={()=>removeFromCart(item.itemId)} style={{background:"none",border:"none",fontSize:15,color:"#c62828",fontWeight:900,lineHeight:1}}>−</button>
                <span style={{fontWeight:900,fontSize:13,minWidth:18,textAlign:"center"}}>{item.qty}</span>
                <button onClick={()=>addToCart(store.menu.find(m=>m.id===item.itemId))} style={{background:"none",border:"none",fontSize:15,color:"#2e7d32",fontWeight:900,lineHeight:1}}>+</button>
              </div>
            </div>
          ))}
        </div>
        <div style={{padding:"12px 14px",borderTop:"2px solid var(--border)"}}>
          {discount>0&&(
            <>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,fontSize:12,color:"var(--sub)"}}>
                <span>قبل الخصم</span><span>{cartTotal.toLocaleString()} {CUR}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:12,color:"#2e7d32",fontWeight:700}}>
                <span>خصم {discount}%</span><span>-{discountAmt.toLocaleString()} {CUR}</span>
              </div>
            </>
          )}
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,fontSize:15,fontWeight:900}}>
            <span>الإجمالي</span>
            <span style={{color:"#c62828"}}>{finalTotal.toLocaleString()} {CUR}</span>
          </div>

          <button onClick={placeOrder} disabled={submitting||!cart.length}
            style={{width:"100%",background:submitting||!cart.length?"#999":"#c62828",color:"#fff",border:"none",
              borderRadius:10,padding:"12px",fontWeight:900,fontSize:14,cursor:submitting||!cart.length?"not-allowed":"pointer"}}>
            {submitting?"⏳ جاري الإرسال...":`✓ تأكيد الطلب${cartCount>0?` (${cartCount})`:""}` }
          </button>
        </div>
      </div>

    </div>
  );
}

// ═══════════════════════════════════
// ORDERS TAB — with edit order feature
// ═══════════════════════════════════
function OrdersTab({store,user,showToast,addNotification,dm,settings}){
  const [filter,setFilter]=useState("active");
  const [search,setSearch]=useState("");
  const [editOrder,setEditOrder]=useState(null);
  const CUR=settings?.currency||"ل.س";
  const canManage=[ROLES.ADMIN,ROLES.CASHIER].includes(user.role);
  const isBarOrHookah=[ROLES.BAR,ROLES.HOOKAH].includes(user.role);
  // فقط الأدمن والكاشير يرون الطلبات المنتهية
  const canSeeHistory=[ROLES.ADMIN,ROLES.CASHIER].includes(user.role);

  const filtered=store.orders.filter(o=>{
    // الموظفون (بار، أراكيل، عامل) يرون الطلبات النشطة فقط
    if(!canSeeHistory && ["paid","cancelled"].includes(o.status)) return false;
    if(filter==="active") return!["paid","cancelled","debt"].includes(o.status);
    if(filter==="debt") return o.status==="debt";
    if(filter==="paid") return canSeeHistory && o.status==="paid";
    if(filter==="cancelled") return canSeeHistory && o.status==="cancelled";
    if(filter==="all") return canSeeHistory || !["paid","cancelled"].includes(o.status);
    return true;
  }).filter(o=>{
    if(!search) return true;
    return (o.orderNum||"").includes(search)||(o.customerName||"").includes(search)||(o.table||"").includes(search);
  }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));

  const updateStatus=(order,newStatus)=>{
    store.setOrders(p=>p.map(o=>o.id===order.id?{...o,status:newStatus}:o));
    if(newStatus==="ready") addNotification(`✅ طلب #${order.orderNum} جاهز`,[ROLES.CASHIER,ROLES.ADMIN,ROLES.WORKER],order.id);
    showToast(`تم تحديث الطلب #${order.orderNum}`);
  };
  const cancelOrder=(order)=>{
    store.setOrders(p=>p.map(o=>o.id===order.id?{...o,status:"cancelled"}:o));
    store.setMenu(p=>p.map(m=>{
      const ci=order.items.find(i=>i.itemId===m.id);
      if(!ci) return m;
      return{...m,stock:m.stock+ci.qty,totalSold:Math.max(0,m.totalSold-ci.qty)};
    }));
    showToast(`تم إلغاء الطلب #${order.orderNum}`,"error");
  };

  const statusBtns={
    pending:["preparing","👨‍🍳 بدء التحضير"],
    preparing:["ready","✅ تعيين جاهز"],
  };

  // Edit order modal
  const EditModal=({order,onClose})=>{
    const [items,setItems]=useState(order.items.map(i=>({...i})));
    const [tbl,setTbl]=useState(order.table||"");
    const [note,setNote]=useState(order.notes||"");
    const total=items.reduce((s,i)=>s+i.price*i.qty,0);
    const save=()=>{
      store.setOrders(p=>p.map(o=>o.id===order.id?{...o,items,table:tbl,notes:note,total}:o));
      showToast("تم تعديل الطلب");onClose();
    };
    return(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:600,padding:20}}>
        <div className="card fade-in" style={{width:"100%",maxWidth:400,maxHeight:"88vh",overflowY:"auto"}}>
          <div style={{fontWeight:900,fontSize:16,marginBottom:16}}>✏ تعديل الطلب #{order.orderNum}</div>
          <input className="input" value={tbl} onChange={e=>setTbl(e.target.value)} placeholder="رقم الطاولة" style={{marginBottom:10}}/>
          <textarea className="input" value={note} onChange={e=>setNote(e.target.value)} style={{height:60,resize:"none",marginBottom:14}} placeholder="ملاحظات"/>
          {items.map((item,idx)=>(
            <div key={idx} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,padding:"6px 10px",background:"var(--card2)",borderRadius:10}}>
              <span style={{fontSize:18}}>{item.emoji}</span>
              <div style={{flex:1,fontSize:13,fontWeight:600}}>{item.itemName}</div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <button onClick={()=>setItems(p=>p.map((it,i)=>i===idx?{...it,qty:Math.max(1,it.qty-1)}:it))}
                  style={{background:"#ffebee",color:"#c62828",border:"none",borderRadius:8,width:28,height:28,fontWeight:900,fontSize:15}}>−</button>
                <span style={{minWidth:24,textAlign:"center",fontWeight:900}}>{item.qty}</span>
                <button onClick={()=>setItems(p=>p.map((it,i)=>i===idx?{...it,qty:it.qty+1}:it))}
                  style={{background:"#e8f5e9",color:"#2e7d32",border:"none",borderRadius:8,width:28,height:28,fontWeight:900,fontSize:15}}>+</button>
                <button onClick={()=>setItems(p=>p.filter((_,i)=>i!==idx))}
                  style={{background:"#ffebee",color:"#c62828",border:"none",borderRadius:8,width:28,height:28,fontSize:13}}>🗑</button>
              </div>
            </div>
          ))}
          <div style={{fontWeight:900,fontSize:15,margin:"10px 0"}}>الإجمالي: {total.toLocaleString()} {CUR}</div>
          <div style={{display:"flex",gap:10}}>
            <button className="btn btn-red" style={{flex:1}} onClick={save}>حفظ</button>
            <button className="btn btn-ghost" style={{flex:1}} onClick={onClose}>إلغاء</button>
          </div>
        </div>
      </div>
    );
  };

  return(
    <div className="fade-in">
      {editOrder&&<EditModal order={editOrder} onClose={()=>setEditOrder(null)}/>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <h2 style={{fontSize:18,fontWeight:900}}>📋 الطلبات ({filtered.length})</h2>
        <input className="input" placeholder="🔍 بحث..." value={search} onChange={e=>setSearch(e.target.value)} style={{maxWidth:200,fontSize:13}}/>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:14,overflowX:"auto"}} className="scroll-hide">
        {[["active","نشطة"],["debt","💳 ديون"],["paid","مدفوعة"],["cancelled","ملغاة"],["all","الكل"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)} style={{padding:"7px 14px",borderRadius:20,border:"none",
            background:filter===v?"#c62828":"var(--card2)",color:filter===v?"#fff":"var(--sub)",
            fontWeight:700,fontSize:12,whiteSpace:"nowrap"}}>
            {l}
          </button>
        ))}
      </div>
      {!filtered.length?(
        <div style={{textAlign:"center",padding:60,color:"var(--sub)"}}>
          <div style={{fontSize:48}}>📋</div><div style={{marginTop:10}}>لا توجد طلبات</div>
        </div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
          {filtered.map(order=>(
            <div key={order.id} className="card slide-in" style={{borderRight:`4px solid ${STATUS_COLORS[order.status]}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontWeight:900,fontSize:15}}># {order.orderNum}</span>
                  {order.table&&<span style={{background:"rgba(21,101,192,.15)",color:"#1565c0",borderRadius:6,
                    padding:"2px 8px",fontSize:11,fontWeight:700}}>🪑 {order.table}</span>}
                </div>
                <span className={`badge s-${order.status}`} style={{fontSize:11,fontWeight:700}}>
                  {STATUS_LABELS[order.status]}
                </span>
              </div>
              <div style={{fontSize:12,color:"var(--sub)",marginBottom:8}}>
                👤 {order.customerName} • {new Date(order.createdAt).toLocaleString("ar-SY",{hour:"2-digit",minute:"2-digit",month:"short",day:"numeric"})}
              </div>
              {["pending","preparing"].includes(order.status)&&(
                <div style={{marginBottom:8}}>
                  <OrderTimer createdAt={order.createdAt} dm={dm}/>
                </div>
              )}
              <div style={{borderTop:"1px dashed var(--border)",paddingTop:8,marginBottom:8}}>
                {order.items.map((item,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"2px 0"}}>
                    <span>{item.emoji} {item.itemName} ×{item.qty}</span>
                    <span style={{color:"#c62828",fontWeight:600}}>{(item.price*item.qty).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              {order.notes&&<div style={{background:"rgba(249,168,37,.1)",borderRadius:8,padding:"6px 10px",fontSize:11,color:"#e65100",marginBottom:8}}>📝 {order.notes}</div>}
              {order.discount>0&&<div style={{fontSize:11,color:"#2e7d32",marginBottom:5}}>خصم {order.discount}%: -{((order.originalTotal||order.total)-order.total).toLocaleString()} {CUR}</div>}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,borderTop:"1px solid var(--border)",paddingTop:8}}>
                <span style={{fontWeight:900,fontSize:14}}>الإجمالي:</span>
                <span style={{fontWeight:900,fontSize:15,color:"#c62828"}}>{order.total.toLocaleString()} {CUR}</span>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {canManage&&statusBtns[order.status]&&(
                  <button onClick={()=>updateStatus(order,statusBtns[order.status][0])}
                    style={{flex:1,background:"#c62828",color:"#fff",border:"none",borderRadius:8,padding:"8px",fontWeight:700,fontSize:12}}>
                    {statusBtns[order.status][1]}
                  </button>
                )}
                {isBarOrHookah&&order.status==="pending"&&(
                  <button onClick={()=>updateStatus(order,"preparing")}
                    style={{flex:1,background:"#1976d2",color:"#fff",border:"none",borderRadius:8,padding:"8px",fontWeight:700,fontSize:12}}>
                    بدء التحضير
                  </button>
                )}
                {canManage&&!["paid","cancelled"].includes(order.status)&&(
                  <>
                    <button onClick={()=>setEditOrder(order)}
                      style={{background:"rgba(25,118,210,.15)",border:"none",borderRadius:8,padding:"8px 10px",fontSize:13,color:"#1565c0"}}>
                      ✏
                    </button>
                    <button onClick={()=>cancelOrder(order)}
                      style={{background:"rgba(198,40,40,.15)",border:"none",borderRadius:8,padding:"8px 10px",fontSize:13,color:"#c62828"}}>
                      🚫
                    </button>
                  </>
                )}
                <button onClick={()=>printOrder(order,store.menu,2,settings)}
                  style={{background:"var(--card2)",border:"none",borderRadius:8,padding:"8px 10px",fontSize:14}}>
                  🖨
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════
// CASHIER TAB
// ═══════════════════════════════════
function CashierTab({store,user,showToast,dm,settings}){
  const CUR=settings?.currency||"ل.س";
  const today=new Date();today.setHours(0,0,0,0);
  const todayPaid=store.orders.filter(o=>o.status==="paid"&&new Date(o.paidAt||o.createdAt)>=today);
  const todayRevenue=todayPaid.reduce((s,o)=>s+o.total,0);
  const readyOrders=store.orders.filter(o=>o.status==="ready");
  const todayExpenses=(store.expenses||[]).filter(e=>new Date(e.date)>=today).reduce((s,e)=>s+e.amount,0);

  const markPaid=(order,discountPct=0)=>{
    const discAmt=Math.round((order.originalTotal||order.total)*discountPct/100);
    const finalTotal=(order.originalTotal||order.total)-discAmt;
    const paid={...order,status:"paid",paymentStatus:"paid",
      paidAt:new Date().toISOString(),paidBy:user.id,paidByName:user.name,
      discount:discountPct,originalTotal:order.originalTotal||order.total,total:finalTotal};
    store.setOrders(p=>p.map(o=>o.id===order.id?paid:o));
    store.setCashLog(p=>[{id:Date.now().toString(),orderId:order.id,orderNum:order.orderNum,
      amount:finalTotal,at:new Date().toISOString(),by:user.name},...p]);
    saveReceipt(paid,settings);
    savePdfArchive(paid,settings);
    showToast(`💰 تم الدفع — ${order.customerName||"زبون"} | #${order.orderNum}`,"paid");
    printOrder(paid,store.menu,2,settings);
  };

  const [debtModal,setDebtModal]=useState(null);
  const [debtNameInput,setDebtNameInput]=useState("");
  const [debtNameError,setDebtNameError]=useState("");

  const markDebt=(order)=>{
    setDebtNameInput(order.customerName!=="زبون"?order.customerName:"");
    setDebtNameError("");
    setDebtModal(order);
  };

  const confirmDebt=()=>{
    if(!debtNameInput.trim()){setDebtNameError("⚠️ يجب إدخال اسم الزبون لتسجيل الدين");return;}
    const order=debtModal;
    store.setOrders(p=>p.map(o=>o.id===order.id?{...o,status:"debt",paymentStatus:"debt",paymentType:"debt",customerName:debtNameInput.trim()}:o));
    store.setDebts(p=>[{
      id:"d"+Date.now(),orderId:order.id,orderNum:order.orderNum,
      customerName:debtNameInput.trim(),amount:order.total,remaining:order.total,
      date:new Date().toISOString(),settled:false,settledAt:null,createdBy:user.name,notes:order.notes||"",
    },...p]);
    showToast(`تم تسجيل الدين للطلب #${order.orderNum} 💳`,"warn");
    setDebtModal(null);setDebtNameInput("");
  };

  return(
    <div className="fade-in">
      <h2 style={{fontSize:18,fontWeight:900,marginBottom:14}}>💰 لوحة الكاشير</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:18}}>
        {[["💵","مبيعات اليوم",`${todayRevenue.toLocaleString()} ${CUR}`,"#2e7d32"],
          ["✅","فواتير مدفوعة",todayPaid.length,"#1976d2"],
          ["⏳","جاهزة للدفع",readyOrders.length,"#f9a825"],
          ["📒","مصاريف اليوم",`${todayExpenses.toLocaleString()} ${CUR}`,"#e65100"],
          ["💹","صافي اليوم",`${(todayRevenue-todayExpenses).toLocaleString()} ${CUR}`, todayRevenue-todayExpenses>=0?"#2e7d32":"#c62828"],
        ].map(([icon,label,val,color])=>(
          <div key={label} className="card" style={{textAlign:"center",borderTop:`4px solid ${color}`}}>
            <div style={{fontSize:24,marginBottom:4}}>{icon}</div>
            <div style={{fontSize:11,color:"var(--sub)",marginBottom:3}}>{label}</div>
            <div style={{fontSize:16,fontWeight:900,color}}>{val}</div>
          </div>
        ))}
      </div>
      {readyOrders.length>0&&(
        <div style={{marginBottom:20}}>
          <h3 style={{fontSize:14,fontWeight:800,marginBottom:10,color:"#2e7d32"}}>✅ جاهزة للدفع ({readyOrders.length})</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(250px,1fr))",gap:10}}>
            {readyOrders.map(order=>(
              <div key={order.id} className="card" style={{borderRight:"4px solid #2e7d32"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontWeight:900}}># {order.orderNum}</span>
                  {order.table&&<span style={{background:"rgba(21,101,192,.15)",color:"#1565c0",fontSize:11,padding:"2px 8px",borderRadius:6,fontWeight:700}}>🪑 {order.table}</span>}
                </div>
                {/* Customer name - prominent */}
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,
                  background:"rgba(21,101,192,.08)",borderRadius:8,padding:"7px 10px"}}>
                  <span style={{fontSize:20}}>👤</span>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:900,fontSize:14,color:"#1565c0"}}>{order.customerName||"زبون"}</div>
                    {order.workerName&&<div style={{fontSize:10,color:"var(--sub)"}}>سجّل: {order.workerName}</div>}
                  </div>
                  {/* Same-table warning */}
                  {readyOrders.filter(o2=>o2.table&&o2.table===order.table&&o2.id!==order.id).length>0&&(
                    <span style={{background:"#fff3e0",color:"#e65100",fontSize:10,padding:"2px 7px",borderRadius:6,fontWeight:700}}>
                      ⚠ زبون آخر بنفس الطاولة
                    </span>
                  )}
                </div>
                {order.items.map((i,idx)=><div key={idx} style={{fontSize:12,padding:"2px 4px",display:"flex",justifyContent:"space-between"}}>
                  <span>{i.emoji} {i.itemName} ×{i.qty}</span>
                  <span style={{color:"#c62828",fontWeight:700}}>{(i.price*i.qty).toLocaleString()} {CUR}</span>
                </div>)}
                {/* Discount field at cashier */}
                <div style={{marginTop:10,padding:"8px 10px",background:"var(--card2)",borderRadius:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",whiteSpace:"nowrap"}}>🏷 خصم %</label>
                    <input type="number" min="0" max="100" defaultValue="0" id={"disc_"+order.id}
                      style={{flex:1,padding:"5px 8px",border:"1.5px solid var(--border)",borderRadius:8,
                        fontSize:13,fontWeight:700,background:"var(--card)",color:"var(--text)",textAlign:"center"}}/>
                  </div>
                </div>
                <div style={{fontWeight:900,color:"#c62828",marginTop:8,fontSize:15,borderTop:"1px dashed var(--border)",paddingTop:8}}>
                  {order.total.toLocaleString()} {CUR}
                </div>
                <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                  <button onClick={()=>{const d=+(document.getElementById("disc_"+order.id)?.value||0);markPaid(order,d);}}
                    style={{flex:1,minWidth:90,background:"#2e7d32",color:"#fff",border:"none",borderRadius:8,padding:"10px",fontWeight:800,fontSize:12}}>
                    💰 مدفوع
                  </button>
                  <button onClick={()=>markDebt(order)}
                    style={{flex:1,minWidth:90,background:"#6a1b9a",color:"#fff",border:"none",borderRadius:8,padding:"10px",fontWeight:800,fontSize:12}}>
                    💳 دين
                  </button>
                  <button onClick={()=>printOrder(order,store.menu,2,settings)}
                    style={{background:"var(--card2)",border:"none",borderRadius:8,padding:"10px 12px",fontSize:14}}>
                    🖨
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <h3 style={{fontSize:14,fontWeight:800,marginBottom:10}}>📜 سجل الكاشير اليوم</h3>
      {!store.cashLog.filter(l=>new Date(l.at)>=today).length?(
        <div style={{textAlign:"center",color:"var(--sub)",padding:24}}>لا توجد معاملات اليوم</div>
      ):(
        <div className="card">
          {store.cashLog.filter(l=>new Date(l.at)>=today).map(l=>(
            <div key={l.id} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid var(--border)"}}>
              <span style={{fontSize:12}}>#{l.orderNum} — {l.by}</span>
              <span style={{fontWeight:800,color:"#2e7d32",fontSize:12}}>{l.amount.toLocaleString()} {CUR}</span>
            </div>
          ))}
          <div style={{display:"flex",justifyContent:"space-between",paddingTop:10,fontWeight:900,fontSize:14,color:"#2e7d32"}}>
            <span>إجمالي اليوم</span><span>{todayRevenue.toLocaleString()} {CUR}</span>
          </div>
        </div>
      )}
      {/* ── modal تسجيل الدين ── */}
      {debtModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:999,
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}
          onClick={e=>{if(e.target===e.currentTarget)setDebtModal(null);}}>
          <div style={{background:"var(--card)",borderRadius:20,padding:28,width:"100%",maxWidth:380,
            boxShadow:"0 24px 60px rgba(0,0,0,.5)"}}>
            <div style={{textAlign:"center",marginBottom:18}}>
              <div style={{fontSize:44,marginBottom:6}}>💳</div>
              <h2 style={{fontSize:18,fontWeight:900,marginBottom:4}}>تسجيل دين</h2>
              <p style={{fontSize:13,color:"var(--sub)"}}>طلب #{debtModal.orderNum} — {debtModal.total.toLocaleString()} {CUR}</p>
            </div>
            <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:6,display:"block"}}>
              👤 اسم الزبون <span style={{color:"#c62828"}}>*</span>
            </label>
            <input className="input" placeholder="أدخل اسم الزبون..." value={debtNameInput}
              autoFocus
              onChange={e=>{setDebtNameInput(e.target.value);setDebtNameError("");}}
              onKeyDown={e=>e.key==="Enter"&&confirmDebt()}
              style={{marginBottom:10,fontSize:16,fontWeight:700}}/>
            {debtNameError&&(
              <div style={{background:"rgba(198,40,40,.15)",color:"#c62828",borderRadius:10,
                padding:"8px 14px",fontSize:13,fontWeight:700,marginBottom:12,
                border:"1px solid rgba(198,40,40,.3)"}}>
                {debtNameError}
              </div>
            )}
            <div style={{display:"flex",gap:10,marginTop:4}}>
              <button onClick={()=>setDebtModal(null)}
                style={{flex:1,padding:12,borderRadius:12,border:"1.5px solid var(--border)",
                  background:"none",color:"var(--text)",fontWeight:700,cursor:"pointer"}}>
                إلغاء
              </button>
              <button onClick={confirmDebt}
                style={{flex:2,padding:12,borderRadius:12,border:"none",
                  background:"#6a1b9a",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer"}}>
                ✓ تسجيل الدين
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ═══════════════════════════════════
// DEBTS TAB — إدارة الديون
// ═══════════════════════════════════
function DebtsTab({store,user,showToast,dm,settings}){
  const CUR=settings?.currency||"ل.س";
  const [filter,setFilter]=useState("unsettled");
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({customerName:"",amount:"",notes:""});

  const debts=store.debts||[];
  const filtered=debts.filter(d=>filter==="all"?true:filter==="settled"?d.settled:!d.settled)
    .sort((a,b)=>new Date(b.date)-new Date(a.date));

  const totalUnsettled=debts.filter(d=>!d.settled).reduce((s,d)=>s+d.remaining,0);
  const totalSettled=debts.filter(d=>d.settled).reduce((s,d)=>s+d.amount,0);

  const settleDebt=(id,amount)=>{
    const debt=store.debts.find(d=>d.id===id);
    store.setDebts(p=>p.map(d=>{
      if(d.id!==id) return d;
      const pay=Math.min(amount,d.remaining);
      const newRemaining=d.remaining-pay;
      return{...d,remaining:newRemaining,settled:newRemaining<=0,settledAt:newRemaining<=0?new Date().toISOString():null};
    }));
    store.setCashLog(p=>[{id:Date.now().toString(),orderId:"debt_"+id,orderNum:"دين",amount,at:new Date().toISOString(),by:user.name,type:"debt_payment"},...p]);
    // ✅ إضافة الدين المستوفى إلى الإيرادات
    const revEntry={
      id:"debt_rev_"+id+"_"+Date.now(),
      orderNum:"D-"+(debt?.customerName||id).slice(0,6),
      customerName:(debt?.customerName||"زبون"),
      debtName:debt?.customerName||"زبون",
      customerId:"debt",table:"-",
      items:[{itemId:"debt",itemName:"استيفاء دين",emoji:"💳",qty:1,price:amount}],
      total:amount,status:"paid",paymentType:"debt_settled",
      notes:"دين مستوفى — "+(debt?.notes||debt?.customerName||""),
      createdAt:new Date().toISOString(),paidAt:new Date().toISOString(),
      paidBy:user.id,paidByName:user.name,discount:0,isDebtSettlement:true,
    };
    store.setOrders(p=>[revEntry,...p]);
    savePdfArchive({...revEntry,debtName:debt?.customerName,paidByName:user.name},settings);
    showToast(`✅ تم استيفاء دين ${debt?.customerName||""} وحفظ الفاتورة`,"paid");
  };

  const addManualDebt=()=>{
    if(!form.customerName||!form.amount){showToast("يرجى ملء الحقول","error");return}
    store.setDebts(p=>[{
      id:"d"+Date.now(),orderId:null,orderNum:"يدوي",
      customerName:form.customerName,amount:+form.amount,remaining:+form.amount,
      date:new Date().toISOString(),settled:false,settledAt:null,
      createdBy:user.name,notes:form.notes,
    },...p]);
    showToast("تم تسجيل الدين");setShowAdd(false);setForm({customerName:"",amount:"",notes:""});
  };

  return(
    <div className="fade-in">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h2 style={{fontSize:18,fontWeight:900}}>💳 سجل الديون</h2>
        <button className="btn btn-red" onClick={()=>setShowAdd(true)}>+ دين يدوي</button>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:18}}>
        <div className="card" style={{borderTop:"4px solid #c62828",textAlign:"center"}}>
          <div style={{fontSize:24,marginBottom:4}}>💳</div>
          <div style={{fontSize:11,color:"var(--sub)"}}>إجمالي الديون</div>
          <div style={{fontSize:18,fontWeight:900,color:"#c62828"}}>{totalUnsettled.toLocaleString()} {CUR}</div>
        </div>
        <div className="card" style={{borderTop:"4px solid #2e7d32",textAlign:"center"}}>
          <div style={{fontSize:24,marginBottom:4}}>✅</div>
          <div style={{fontSize:11,color:"var(--sub)"}}>ديون مستوفاة</div>
          <div style={{fontSize:18,fontWeight:900,color:"#2e7d32"}}>{totalSettled.toLocaleString()} {CUR}</div>
        </div>
        <div className="card" style={{borderTop:"4px solid #f9a825",textAlign:"center"}}>
          <div style={{fontSize:24,marginBottom:4}}>📋</div>
          <div style={{fontSize:11,color:"var(--sub)"}}>ديون معلقة</div>
          <div style={{fontSize:18,fontWeight:900,color:"#f9a825"}}>{debts.filter(d=>!d.settled).length}</div>
        </div>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {[["unsettled","معلقة"],["settled","مستوفاة"],["all","الكل"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFilter(v)} style={{padding:"7px 16px",borderRadius:20,border:"none",
            background:filter===v?"#c62828":"var(--card2)",color:filter===v?"#fff":"var(--sub)",fontWeight:700,fontSize:12}}>
            {l}
          </button>
        ))}
      </div>

      {!filtered.length?(
        <div style={{textAlign:"center",padding:60,color:"var(--sub)"}}>
          <div style={{fontSize:48}}>💳</div><div style={{marginTop:10}}>لا توجد ديون</div>
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {filtered.map(d=>(
            <div key={d.id} className="card" style={{borderRight:`4px solid ${d.settled?"#2e7d32":"#c62828"}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div>
                  <div style={{fontWeight:900,fontSize:15}}>👤 {d.customerName}</div>
                  <div style={{fontSize:11,color:"var(--sub)"}}>
                    {new Date(d.date).toLocaleDateString("ar-SY")} • طلب #{d.orderNum}
                  </div>
                </div>
                <span style={{background:d.settled?"rgba(46,125,50,.2)":"rgba(198,40,40,.2)",
                  color:d.settled?"#2e7d32":"#c62828",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:700}}>
                  {d.settled?"✅ مستوفى":"⏳ معلق"}
                </span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,fontSize:14}}>
                <span style={{color:"var(--sub)"}}>المبلغ الأصلي:</span>
                <span style={{fontWeight:700}}>{d.amount.toLocaleString()} {CUR}</span>
              </div>
              {!d.settled&&d.remaining!==d.amount&&(
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,fontSize:14}}>
                  <span style={{color:"var(--sub)"}}>المتبقي:</span>
                  <span style={{fontWeight:900,color:"#c62828"}}>{d.remaining.toLocaleString()} {CUR}</span>
                </div>
              )}
              {d.notes&&<div style={{fontSize:12,color:"var(--sub)",marginBottom:8}}>📝 {d.notes}</div>}
              {!d.settled&&(
                <div style={{display:"flex",gap:8,marginTop:8}}>
                  <button onClick={()=>settleDebt(d.id,d.remaining)}
                    style={{flex:1,background:"#2e7d32",color:"#fff",border:"none",borderRadius:8,padding:"9px",fontWeight:700,fontSize:12}}>
                    ✅ استيفاء كامل ({d.remaining.toLocaleString()} {CUR})
                  </button>
                  <button onClick={()=>{
                    const v=window.prompt(`استيفاء جزئي (المتبقي: ${d.remaining.toLocaleString()} ${CUR}):`);
                    const n=+v;
                    if(v&&n>0&&n<=d.remaining) settleDebt(d.id,n);
                    else if(v) showToast("مبلغ غير صحيح","error");
                  }} style={{background:"rgba(46,125,50,.2)",color:"#2e7d32",border:"none",borderRadius:8,padding:"9px 12px",fontWeight:700,fontSize:12}}>
                    جزئي
                  </button>
                </div>
              )}
              {d.settled&&d.settledAt&&(
                <div style={{fontSize:11,color:"#2e7d32",marginTop:6}}>
                  ✅ استوفي بتاريخ {new Date(d.settledAt).toLocaleDateString("ar-SY")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}}>
          <div className="card fade-in" style={{width:"100%",maxWidth:380}}>
            <div style={{fontWeight:900,fontSize:16,marginBottom:16}}>➕ تسجيل دين يدوي</div>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>اسم الزبون</label>
              <input className="input" value={form.customerName} onChange={e=>setForm(f=>({...f,customerName:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>المبلغ ({CUR})</label>
              <input className="input" type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>ملاحظات</label>
              <textarea className="input" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{height:60,resize:"none"}}/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button className="btn btn-red" style={{flex:1}} onClick={addManualDebt}>تسجيل</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setShowAdd(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════
// EXPENSES TAB — المصاريف
// ═══════════════════════════════════
function ExpensesTab({store,user,showToast,dm,settings}){
  const CUR=settings?.currency||"ل.س";
  const today=new Date();today.setHours(0,0,0,0);
  const [showAdd,setShowAdd]=useState(false);
  const [period,setPeriod]=useState("today");
  const [form,setForm]=useState({description:"",amount:"",category:"other",notes:"",isSecondary:false});

  const expCats=[
    {id:"supplies",label:"🛒 مستلزمات"},
    {id:"salary",label:"👷 رواتب"},
    {id:"rent",label:"🏠 إيجار"},
    {id:"utilities",label:"💡 خدمات"},
    {id:"maintenance",label:"🔧 صيانة"},
    {id:"other",label:"📦 أخرى"},
  ];

  const getStart=()=>{
    const d=new Date();
    if(period==="today"){d.setHours(0,0,0,0);return d}
    if(period==="week"){d.setDate(d.getDate()-7);return d}
    if(period==="month"){d.setDate(1);d.setHours(0,0,0,0);return d}
    return new Date(0);
  };

  const expenses=store.expenses||[];
  const filtered=expenses.filter(e=>new Date(e.date)>=getStart()).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const total=filtered.reduce((s,e)=>s+e.amount,0);

  const addExpense=()=>{
    if(!form.description||!form.amount){showToast("يرجى ملء الحقول","error");return}
    store.setExpenses(p=>[{
      id:"exp"+Date.now(),description:form.description,label:form.description,amount:+form.amount,
      category:form.category,notes:form.notes,
      date:new Date().toISOString(),createdBy:user.name,by:user.name,
      isSecondary:form.isSecondary||false,
    },...p]);
    showToast(form.isSecondary?"تم تسجيل المصروف الثانوي ⭐":"تم تسجيل المصروف");
    setShowAdd(false);setForm({description:"",amount:"",category:"other",notes:"",isSecondary:false});
  };

  return(
    <div className="fade-in">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h2 style={{fontSize:18,fontWeight:900}}>📒 المصاريف</h2>
        <button className="btn btn-red" onClick={()=>setShowAdd(true)}>+ مصروف جديد</button>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {[["today","اليوم"],["week","الأسبوع"],["month","الشهر"],["all","الكل"]].map(([v,l])=>(
          <button key={v} onClick={()=>setPeriod(v)} style={{padding:"7px 14px",borderRadius:20,border:"none",
            background:period===v?"#c62828":"var(--card2)",color:period===v?"#fff":"var(--sub)",fontWeight:700,fontSize:12}}>
            {l}
          </button>
        ))}
      </div>

      <div className="card" style={{marginBottom:16,borderRight:"4px solid #e65100"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:13,color:"var(--sub)"}}>إجمالي المصاريف</div>
          <div style={{fontSize:22,fontWeight:900,color:"#e65100"}}>{total.toLocaleString()} {CUR}</div>
        </div>
      </div>

      {!filtered.length?(
        <div style={{textAlign:"center",padding:60,color:"var(--sub)"}}>
          <div style={{fontSize:48}}>📒</div><div style={{marginTop:10}}>لا توجد مصاريف</div>
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {filtered.map(e=>{
            const cat=expCats.find(c=>c.id===e.category)||expCats[expCats.length-1];
            return(
              <div key={e.id} className="card" style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{fontSize:28}}>{cat.label.split(" ")[0]}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:14}}>{e.description}</div>
                  <div style={{fontSize:11,color:"var(--sub)"}}>
                    {cat.label.split(" ").slice(1).join(" ")} • {new Date(e.date).toLocaleDateString("ar-SY")} • {e.createdBy}
                  </div>
                  {e.notes&&<div style={{fontSize:11,color:"var(--sub)"}}>📝 {e.notes}</div>}
                </div>
                <div style={{fontWeight:900,color:"#e65100",fontSize:15}}>{e.amount.toLocaleString()} {CUR}</div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}}>
          <div className="card fade-in" style={{width:"100%",maxWidth:380,maxHeight:"88vh",overflowY:"auto"}}>
            <div style={{fontWeight:900,fontSize:16,marginBottom:16}}>➕ مصروف جديد</div>
            {[["الوصف","description","text"],["المبلغ","amount","number"]].map(([label,key,type])=>(
              <div key={key} style={{marginBottom:12}}>
                <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>{label}</label>
                <input className="input" type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/>
              </div>
            ))}
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>الفئة</label>
              <select className="input" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                {expCats.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>ملاحظات</label>
              <textarea className="input" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{height:60,resize:"none"}}/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <div style={{marginBottom:10}}>
                <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",
                  padding:"10px 14px",borderRadius:12,
                  background:form.isSecondary?"rgba(249,168,37,.15)":"var(--card2)",
                  border:form.isSecondary?"1.5px solid #f9a825":"1.5px solid var(--border)"}}>
                  <input type="checkbox" checked={form.isSecondary||false}
                    onChange={e=>setForm(f=>({...f,isSecondary:e.target.checked}))}
                    style={{width:18,height:18,accentColor:"#f9a825"}}/>
                  <span style={{fontWeight:700,fontSize:13,color:form.isSecondary?"#f9a825":"var(--text)"}}>
                    ⭐ مصروف ثانوي (لا يدخل في الجرد اليومي)
                  </span>
                </label>
              </div>
              <button className="btn btn-red" style={{flex:1,background:form.isSecondary?"#f9a825":undefined}} onClick={addExpense}>تسجيل</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setShowAdd(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════
// BAR TAB
// ═══════════════════════════════════
function BarTab({store,user,showToast,addNotification,dm,settings}){
  const canDecrease=user.role===ROLES.ADMIN||(settings?.workerCanDecreaseStock??false);
  const barOrders=store.orders.filter(o=>
    ["pending","preparing"].includes(o.status)&&
    o.items.some(i=>["hot_drinks","cold_drinks"].includes(store.menu.find(m=>m.id===i.itemId)?.category))
  ).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const barItems=store.menu.filter(m=>["hot_drinks","cold_drinks"].includes(m.category));

  const updateStock=(id,delta)=>{
    if(delta<0&&!canDecrease){showToast("غير مسموح بتخفيض المخزون","warn");return}
    store.setMenu(p=>p.map(m=>m.id===id?{...m,stock:Math.max(0,m.stock+delta)}:m));
  };
  const markReady=(order)=>{
    store.setOrders(p=>p.map(o=>o.id===order.id?{...o,status:"ready"}:o));
    addNotification(`✅ طلب #${order.orderNum} جاهز من البار`,[ROLES.CASHIER,ROLES.ADMIN,ROLES.WORKER],order.id);
    showToast(`طلب #${order.orderNum} جاهز ✅`);
  };

  return(
    <div className="fade-in">
      <h2 style={{fontSize:18,fontWeight:900,marginBottom:14}}>🥤 لوحة البار</h2>
      <h3 style={{fontSize:14,fontWeight:800,marginBottom:10,color:"#c62828"}}>⏳ طلبات البار ({barOrders.length})</h3>
      {!barOrders.length?(
        <div className="card" style={{textAlign:"center",padding:24,color:"var(--sub)",marginBottom:16}}>✓ لا توجد طلبات</div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10,marginBottom:20}}>
          {barOrders.map(order=>{
            const drinkItems=order.items.filter(i=>["hot_drinks","cold_drinks"].includes(store.menu.find(m=>m.id===i.itemId)?.category));
            return(
              <div key={order.id} className="card" style={{borderRight:`4px solid ${STATUS_COLORS[order.status]}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontWeight:900,fontSize:15}}># {order.orderNum}</span>
                  <OrderTimer createdAt={order.createdAt} dm={dm}/>
                </div>
                {order.table&&<div style={{fontSize:12,color:"#1976d2",fontWeight:700,marginBottom:6}}>🪑 طاولة {order.table}</div>}
                {drinkItems.map((i,idx)=>(
                  <div key={idx} style={{display:"flex",alignItems:"center",gap:8,padding:"3px 0",fontSize:13}}>
                    <span style={{fontSize:18}}>{i.emoji}</span>
                    <span style={{fontWeight:600}}>{i.itemName}</span>
                    <span style={{marginRight:"auto",fontWeight:900,color:"#c62828"}}>×{i.qty}</span>
                  </div>
                ))}
                {order.notes&&<div style={{background:"rgba(249,168,37,.1)",borderRadius:6,padding:"5px 8px",fontSize:11,color:"#e65100",marginTop:6}}>📝 {order.notes}</div>}
                <div style={{display:"flex",gap:8,marginTop:10}}>
                  {order.status==="pending"&&(
                    <button onClick={()=>store.setOrders(p=>p.map(o=>o.id===order.id?{...o,status:"preparing"}:o))}
                      style={{flex:1,background:"#1976d2",color:"#fff",border:"none",borderRadius:8,padding:"8px",fontWeight:700,fontSize:12}}>
                      👨‍🍳 بدء
                    </button>
                  )}
                  {order.status==="preparing"&&(
                    <button onClick={()=>markReady(order)}
                      style={{flex:1,background:"#2e7d32",color:"#fff",border:"none",borderRadius:8,padding:"8px",fontWeight:700,fontSize:12}}>
                      ✅ جاهز
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h3 style={{fontSize:14,fontWeight:800,marginBottom:10}}>📦 مخزون البار</h3>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
        {barItems.map(item=>(
          <div key={item.id} className="card">
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <span style={{fontSize:24}}>{item.emoji}</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:12}}>{item.name}</div>
                <div style={{fontSize:10,color:item.stock<=item.minStock?"#c62828":"var(--sub)"}}>
                  {item.stock<=item.minStock?"⚠ منخفض":"✓ متوفر"} — {item.stock}
                </div>
              </div>
            </div>
            <div style={{height:5,background:"var(--border)",borderRadius:4,marginBottom:10}}>
              <div style={{height:"100%",width:`${Math.min(100,(item.stock/Math.max(item.minStock*2,1))*100)}%`,
                background:item.stock<=item.minStock?"#c62828":"#2e7d32",borderRadius:4}}/>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",justifyContent:"center"}}>
              {canDecrease&&(
                <button onClick={()=>updateStock(item.id,-1)}
                  style={{width:30,height:30,background:"rgba(198,40,40,.15)",color:"#c62828",border:"none",borderRadius:8,fontWeight:900,fontSize:16}}>
                  −
                </button>
              )}
              <span style={{fontWeight:900,fontSize:15,minWidth:30,textAlign:"center"}}>{item.stock}</span>
              <button onClick={()=>updateStock(item.id,1)}
                style={{width:30,height:30,background:"rgba(46,125,50,.15)",color:"#2e7d32",border:"none",borderRadius:8,fontWeight:900,fontSize:16}}>
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════
// HOOKAH TAB (Narghile)
// ═══════════════════════════════════
function HookahTab({store,user,showToast,addNotification,dm,settings}){
  const canDecrease=user.role===ROLES.ADMIN||(settings?.workerCanDecreaseStock??false);
  const hookahOrders=store.orders.filter(o=>
    ["pending","preparing"].includes(o.status)&&
    o.items.some(i=>store.menu.find(m=>m.id===i.itemId)?.category==="hookah")
  ).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const hookahItems=store.menu.filter(m=>m.category==="hookah");

  const updateStock=(id,delta)=>{
    if(delta<0&&!canDecrease){showToast("غير مسموح بتخفيض المخزون","warn");return}
    store.setMenu(p=>p.map(m=>m.id===id?{...m,stock:Math.max(0,m.stock+delta)}:m));
  };
  const markReady=(order)=>{
    store.setOrders(p=>p.map(o=>o.id===order.id?{...o,status:"ready"}:o));
    addNotification(`✅ طلب الأراكيل #${order.orderNum} جاهز`,[ROLES.CASHIER,ROLES.ADMIN,ROLES.WORKER],order.id);
    showToast(`طلب #${order.orderNum} جاهز ✅`);
  };

  return(
    <div className="fade-in">
      <h2 style={{fontSize:18,fontWeight:900,marginBottom:14}}>💨 لوحة النرجيلة</h2>
      <h3 style={{fontSize:14,fontWeight:800,marginBottom:10,color:"#c62828"}}>⏳ طلبات النرجيلة ({hookahOrders.length})</h3>
      {!hookahOrders.length?(
        <div className="card" style={{textAlign:"center",padding:24,color:"var(--sub)",marginBottom:16}}>✓ لا توجد طلبات</div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10,marginBottom:20}}>
          {hookahOrders.map(order=>{
            const hItems=order.items.filter(i=>store.menu.find(m=>m.id===i.itemId)?.category==="hookah");
            return(
              <div key={order.id} className="card" style={{borderRight:`4px solid ${STATUS_COLORS[order.status]}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontWeight:900,fontSize:15}}># {order.orderNum}</span>
                  <OrderTimer createdAt={order.createdAt} dm={dm} warnAfter={300}/>
                </div>
                {order.table&&<div style={{fontSize:12,color:"#1976d2",fontWeight:700,marginBottom:6}}>🪑 طاولة {order.table}</div>}
                {hItems.map((i,idx)=>(
                  <div key={idx} style={{display:"flex",alignItems:"center",gap:8,padding:"3px 0",fontSize:13}}>
                    <span>💨</span><span style={{fontWeight:600}}>{i.itemName}</span>
                    <span style={{marginRight:"auto",fontWeight:900,color:"#c62828"}}>×{i.qty}</span>
                  </div>
                ))}
                {order.notes&&<div style={{background:"rgba(249,168,37,.1)",borderRadius:6,padding:"5px 8px",fontSize:11,color:"#e65100",marginTop:6}}>📝 {order.notes}</div>}
                <div style={{display:"flex",gap:8,marginTop:10}}>
                  {order.status==="pending"&&(
                    <button onClick={()=>store.setOrders(p=>p.map(o=>o.id===order.id?{...o,status:"preparing"}:o))}
                      style={{flex:1,background:"#6a1b9a",color:"#fff",border:"none",borderRadius:8,padding:"8px",fontWeight:700,fontSize:12}}>
                      🔥 بدء
                    </button>
                  )}
                  {order.status==="preparing"&&(
                    <button onClick={()=>markReady(order)}
                      style={{flex:1,background:"#2e7d32",color:"#fff",border:"none",borderRadius:8,padding:"8px",fontWeight:700,fontSize:12}}>
                      ✅ جاهز
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <h3 style={{fontSize:14,fontWeight:800,marginBottom:10}}>📦 مخزون النرجيلة</h3>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
        {hookahItems.map(item=>(
          <div key={item.id} className="card">
            <div style={{textAlign:"center",fontSize:30,marginBottom:6}}>💨</div>
            <div style={{fontWeight:700,fontSize:12,textAlign:"center",marginBottom:6}}>{item.name}</div>
            <div style={{height:5,background:"var(--border)",borderRadius:4,marginBottom:10}}>
              <div style={{height:"100%",width:`${Math.min(100,(item.stock/Math.max(item.minStock*2,1))*100)}%`,
                background:item.stock<=item.minStock?"#c62828":"#6a1b9a",borderRadius:4}}/>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",justifyContent:"center"}}>
              {canDecrease&&(
                <button onClick={()=>updateStock(item.id,-1)}
                  style={{width:30,height:30,background:"rgba(198,40,40,.15)",color:"#c62828",border:"none",borderRadius:8,fontWeight:900,fontSize:16}}>
                  −
                </button>
              )}
              <span style={{fontWeight:900,fontSize:15,minWidth:30,textAlign:"center"}}>{item.stock}</span>
              <button onClick={()=>updateStock(item.id,1)}
                style={{width:30,height:30,background:"rgba(106,27,154,.15)",color:"#6a1b9a",border:"none",borderRadius:8,fontWeight:900,fontSize:16}}>
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════
// MENU TAB (Admin)
// ═══════════════════════════════════
function MenuTab({store,showToast,dm,settings}){
  const [showForm,setShowForm]=useState(false);
  const [editItem,setEditItem]=useState(null);
  const [form,setForm]=useState({name:"",nameEn:"",price:"",category:"hot_drinks",stock:"",minStock:"10",emoji:"☕"});
  const [cat,setCat]=useState("all");

  const filtered=cat==="all"?store.menu:store.menu.filter(m=>m.category===cat);

  const save=()=>{
    if(!form.name||!form.price){showToast("يرجى ملء الحقول الأساسية","error");return}
    if(editItem){
      store.setMenu(p=>p.map(m=>m.id===editItem.id?{...m,...form,price:+form.price,stock:+form.stock,minStock:+form.minStock}:m));
      showToast("تم تعديل الصنف");
    } else {
      store.setMenu(p=>[...p,{id:"m"+Date.now(),...form,price:+form.price,stock:+form.stock,minStock:+form.minStock,totalSold:0}]);
      showToast("تم إضافة الصنف");
    }
    setShowForm(false);setEditItem(null);setForm({name:"",nameEn:"",price:"",category:"hot_drinks",stock:"",minStock:"10",emoji:"☕"});
  };

  const openEdit=(item)=>{
    setEditItem(item);
    setForm({name:item.name,nameEn:item.nameEn||"",price:String(item.price),category:item.category,stock:String(item.stock),minStock:String(item.minStock),emoji:item.emoji||"☕"});
    setShowForm(true);
  };

  const CUR=settings?.currency||"ل.س";

  return(
    <div className="fade-in">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <h2 style={{fontSize:18,fontWeight:900}}>🍽 إدارة المنيو</h2>
        <button className="btn btn-red" onClick={()=>{setEditItem(null);setShowForm(true)}}>+ إضافة صنف</button>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:14,overflowX:"auto"}} className="scroll-hide">
        <button onClick={()=>setCat("all")} style={{padding:"7px 14px",borderRadius:20,border:"none",
          background:cat==="all"?"#c62828":"var(--card2)",color:cat==="all"?"#fff":"var(--sub)",fontWeight:700,fontSize:12,whiteSpace:"nowrap"}}>
          🍽 الكل
        </button>
        {CAT_ORDER.map(c=>(
          <button key={c} onClick={()=>setCat(c)} style={{padding:"7px 14px",borderRadius:20,border:"none",
            background:cat===c?"#c62828":"var(--card2)",color:cat===c?"#fff":"var(--sub)",fontWeight:700,fontSize:12,whiteSpace:"nowrap"}}>
            {CAT_LABELS[c]}
          </button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(185px,1fr))",gap:12}}>
        {filtered.map(item=>(
          <div key={item.id} className="card" style={{position:"relative"}}>
            <div style={{fontSize:32,textAlign:"center",marginBottom:6}}>{item.emoji}</div>
            <div style={{fontWeight:800,fontSize:13,textAlign:"center"}}>{item.name}</div>
            <div style={{fontSize:11,textAlign:"center",color:"var(--sub)",marginBottom:2}}>{CAT_LABELS[item.category]}</div>
            <div style={{color:"#c62828",fontWeight:900,textAlign:"center",fontSize:14,marginTop:4}}>
              {item.price.toLocaleString()} {CUR}
            </div>
            <div style={{textAlign:"center",fontSize:10,color:item.stock<=item.minStock?"#ff9800":"var(--sub)",marginTop:3}}>
              مخزون: {item.stock} | مباع: {item.totalSold}
            </div>
            <div style={{display:"flex",gap:8,marginTop:10}}>
              <button onClick={()=>openEdit(item)} style={{flex:1,background:"rgba(46,125,50,.15)",color:"#2e7d32",border:"none",borderRadius:8,padding:"7px",fontSize:12,fontWeight:700}}>✏ تعديل</button>
              <button onClick={()=>{store.setMenu(p=>p.filter(m=>m.id!==item.id));showToast("تم حذف الصنف")}}
                style={{background:"rgba(198,40,40,.15)",color:"#c62828",border:"none",borderRadius:8,padding:"7px 10px"}}>🗑</button>
            </div>
          </div>
        ))}
      </div>

      {showForm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}}>
          <div className="card fade-in" style={{width:"100%",maxWidth:400,maxHeight:"88vh",overflowY:"auto"}}>
            <div style={{fontWeight:900,fontSize:16,marginBottom:16}}>{editItem?"✏ تعديل الصنف":"➕ إضافة صنف"}</div>
            {[["الاسم بالعربية","name","text"],["الاسم بالإنجليزية","nameEn","text"],["السعر","price","number"],["المخزون","stock","number"],["الحد الأدنى","minStock","number"],["إيموجي","emoji","text"]].map(([label,key,type])=>(
              <div key={key} style={{marginBottom:12}}>
                <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>{label}</label>
                <input className="input" type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/>
              </div>
            ))}
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>الفئة</label>
              <select className="input" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                {CAT_ORDER.map(c=><option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button className="btn btn-red" style={{flex:1}} onClick={save}>حفظ</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>{setShowForm(false);setEditItem(null)}}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════
// TABLES TAB
// ═══════════════════════════════════
function TablesTab({store,showToast,dm,settings}){
  const [numTables,setNumTables]=useState(store.tables.length||10);
  const [editing,setEditing]=useState(false);
  const CUR=settings?.currency||"ل.س";

  const initTables=(n)=>{
    const tables=Array.from({length:n},(_,i)=>({
      id:`t${i+1}`,number:i+1,label:`طاولة ${i+1}`,seats:4,status:"free",openedAt:null,note:""
    }));
    store.setTables(tables);showToast(`تم إعداد ${n} طاولة`);setEditing(false);
  };

  const toggleStatus=(id)=>store.setTables(p=>p.map(t=>t.id===id?{
    ...t,status:t.status==="free"?"occupied":"free",
    openedAt:t.status==="free"?new Date().toISOString():null
  }:t));

  const TableTimer=({openedAt})=>{
    const [elapsed,setElapsed]=useState(Math.floor((Date.now()-new Date(openedAt))/1000));
    useEffect(()=>{const t=setInterval(()=>setElapsed(e=>e+1),1000);return()=>clearInterval(t);},[]);
    const h=Math.floor(elapsed/3600),m=Math.floor((elapsed%3600)/60);
    return<span style={{fontSize:11,color:"#f9a825",fontWeight:700}}>⏱ {h>0?`${h}س `:""}{m}د</span>;
  };

  const activeOrders=(num)=>store.orders.filter(o=>o.table===String(num)&&!["paid","cancelled"].includes(o.status));
  const free=store.tables.filter(t=>t.status==="free").length;
  const occupied=store.tables.filter(t=>t.status==="occupied").length;

  if(!store.tables.length||editing){
    return(
      <div className="fade-in">
        <h2 style={{fontSize:18,fontWeight:900,marginBottom:20}}>🪑 إعداد الطاولات</h2>
        <div className="card" style={{maxWidth:360}}>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:13,fontWeight:700,color:"var(--sub)",marginBottom:8,display:"block"}}>عدد الطاولات</label>
            <input className="input" type="number" min="1" max="50" value={numTables} onChange={e=>setNumTables(+e.target.value)}/>
          </div>
          <div style={{display:"flex",gap:10}}>
            <button className="btn btn-red" style={{flex:1}} onClick={()=>initTables(numTables)}>إنشاء الطاولات</button>
            {store.tables.length>0&&<button className="btn btn-ghost" style={{flex:1}} onClick={()=>setEditing(false)}>إلغاء</button>}
          </div>
        </div>
      </div>
    );
  }

  return(
    <div className="fade-in">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h2 style={{fontSize:18,fontWeight:900}}>🪑 خريطة الطاولات</h2>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{background:"rgba(46,125,50,.15)",color:"#2e7d32",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:700}}>شاغرة: {free}</span>
          <span style={{background:"rgba(198,40,40,.15)",color:"#c62828",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:700}}>مشغولة: {occupied}</span>
          <button onClick={()=>setEditing(true)} className="btn btn-ghost" style={{padding:"7px 12px",fontSize:12}}>⚙ تعديل</button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))",gap:12}}>
        {store.tables.map(t=>{
          const orders=activeOrders(t.number);
          const total=orders.reduce((s,o)=>s+o.total,0);
          return(
            <div key={t.id} className="card" style={{borderTop:`4px solid ${t.status==="free"?"#2e7d32":"#c62828"}`,cursor:"pointer"}} onClick={()=>toggleStatus(t.id)}>
              <div style={{textAlign:"center",fontSize:26,marginBottom:6}}>🪑</div>
              <div style={{fontWeight:900,textAlign:"center",fontSize:14}}>{t.label}</div>
              <div style={{textAlign:"center",marginTop:6}}>
                <span style={{background:t.status==="free"?"rgba(46,125,50,.15)":"rgba(198,40,40,.15)",
                  color:t.status==="free"?"#2e7d32":"#c62828",borderRadius:20,padding:"3px 12px",fontSize:12,fontWeight:700}}>
                  {t.status==="free"?"شاغرة":"مشغولة"}
                </span>
              </div>
              {t.status==="occupied"&&t.openedAt&&(
                <div style={{textAlign:"center",marginTop:8}}><TableTimer openedAt={t.openedAt}/></div>
              )}
              {orders.length>0&&(
                <div style={{marginTop:8,background:"var(--card2)",borderRadius:8,padding:"6px 8px",textAlign:"center"}}>
                  <div style={{fontSize:10,color:"var(--sub)"}}>{orders.length} طلب نشط</div>
                  <div style={{fontSize:12,fontWeight:700,color:"#c62828"}}>{total.toLocaleString()} {CUR}</div>
                </div>
              )}
              <button onClick={async(e)=>{
                e.stopPropagation();
                const {generateTableQR}=await import("./lib/utils.js");
                const qr=await generateTableQR(t.number);
                if(qr){const w=window.open("","_blank","width=320,height=360");if(w){w.document.write(`<html><body style="text-align:center;padding:20px;font-family:sans-serif"><h3>طاولة ${t.number}</h3><img src="${qr}" width="256"/><br/><small>${window.location.origin}?table=${t.number}</small></body></html>`);w.document.close();}}
              }} style={{width:"100%",marginTop:8,background:"transparent",border:"1px solid var(--border)",borderRadius:8,padding:"5px",fontSize:11,color:"var(--sub)"}}>
                QR 📱
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════
// STAFF TAB (Admin)
// ═══════════════════════════════════
function StaffTab({store,showToast,dm}){
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({name:"",username:"",password:"",email:"",role:ROLES.CASHIER,shift:""});

  const roleGroups=Object.values(ROLES).filter(r=>r!==ROLES.CUSTOMER).map(r=>({
    role:r,label:ROLE_LABELS[r],color:ROLE_COLORS[r],
    users:store.users.filter(u=>u.role===r)
  }));

  const addUser=()=>{
    if(!form.name||!form.username||!form.password){showToast("يرجى ملء الحقول الأساسية","error");return}
    if(store.users.find(u=>u.username===form.username)){showToast("اسم المستخدم موجود مسبقاً","error");return}
    store.setUsers(p=>[...p,{id:"u"+Date.now(),...form,email:form.email||`${form.username}@nardeen.cafe`,active:true}]);
    showToast("تم إضافة الموظف بنجاح");
    setShowAdd(false);setForm({name:"",username:"",password:"",email:"",role:ROLES.CASHIER,shift:""});
  };
  const toggleActive=(id)=>store.setUsers(p=>p.map(u=>u.id===id?{...u,active:!u.active}:u));
  const resetPass=(id)=>{
    const p=window.prompt("كلمة المرور الجديدة:");
    if(p&&p.length>=4){store.setUsers(q=>q.map(u=>u.id===id?{...u,password:p}:u));showToast("تم تغيير كلمة المرور");}
  };
  const deleteUser=(id)=>{
    if(window.confirm("هل تريد حذف هذا الموظف؟")){store.setUsers(p=>p.filter(u=>u.id!==id));showToast("تم حذف الموظف");}
  };

  return(
    <div className="fade-in">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
        <h2 style={{fontSize:18,fontWeight:900}}>👥 إدارة الموظفين</h2>
        <button className="btn btn-red" onClick={()=>setShowAdd(true)}>+ إضافة موظف</button>
      </div>
      {roleGroups.filter(g=>g.users.length>0).map(({role,label,color,users})=>(
        <div key={role} style={{marginBottom:22}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{width:4,height:18,background:color,borderRadius:4}}/>
            <h3 style={{fontSize:14,fontWeight:800,color}}>{label} ({users.length})</h3>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(225px,1fr))",gap:10}}>
            {users.map(u=>(
              <div key={u.id} className="card" style={{borderTop:`3px solid ${color}`,opacity:u.active?1:.6}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:13}}>{u.name}</div>
                    <div style={{fontSize:11,color:"var(--sub)"}}>@{u.username}{u.shift?` • ${u.shift}`:""}</div>
                  </div>
                  <span style={{background:u.active?"rgba(46,125,50,.15)":"rgba(198,40,40,.15)",
                    color:u.active?"#2e7d32":"#c62828",borderRadius:20,padding:"3px 10px",fontSize:10,fontWeight:700}}>
                    {u.active?"نشط":"موقوف"}
                  </span>
                </div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  <button onClick={()=>toggleActive(u.id)} style={{flex:1,minWidth:60,padding:"6px",border:"none",borderRadius:8,
                    background:u.active?"rgba(198,40,40,.15)":"rgba(46,125,50,.15)",
                    color:u.active?"#c62828":"#2e7d32",fontWeight:700,fontSize:11}}>
                    {u.active?"إيقاف":"تفعيل"}
                  </button>
                  <button onClick={()=>resetPass(u.id)} style={{flex:1,minWidth:60,padding:"6px",border:"none",borderRadius:8,
                    background:"var(--card2)",color:"var(--text)",fontWeight:700,fontSize:11}}>
                    🔑 كلمة المرور
                  </button>
                  <button onClick={()=>deleteUser(u.id)} style={{padding:"6px 10px",border:"none",borderRadius:8,
                    background:"rgba(198,40,40,.15)",color:"#c62828",fontSize:13}}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {showAdd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}}>
          <div className="card fade-in" style={{width:"100%",maxWidth:380,maxHeight:"88vh",overflowY:"auto"}}>
            <div style={{fontWeight:900,fontSize:16,marginBottom:16}}>➕ إضافة موظف جديد</div>
            {[["الاسم الكامل","name","text"],["اسم المستخدم","username","text"],["كلمة المرور","password","password"],["البريد الإلكتروني (اختياري)","email","email"],["الوردية (اختياري)","shift","text"]].map(([label,key,type])=>(
              <div key={key} style={{marginBottom:12}}>
                <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>{label}</label>
                <input className="input" type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/>
              </div>
            ))}
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>الدور</label>
              <select className="input" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
                {Object.entries(ROLE_LABELS).filter(([v])=>v!==ROLES.CUSTOMER).map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button className="btn btn-red" style={{flex:1}} onClick={addUser}>إضافة</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>setShowAdd(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════
// REPORTS TAB
// ═══════════════════════════════════
function ReportsTab({store,dm,settings}){
  const CUR=settings?.currency||"ل.س";
  const [period,setPeriod]=useState("today");
  const [reportTab,setReportTab]=useState("summary");
  const [pdfSearch,setPdfSearch]=useState("");
  const pdfArchive=useMemo(()=>JSON.parse(localStorage.getItem("nc_pdf_archive")||"[]"),[reportTab]);
  const filteredPdfs=useMemo(()=>pdfArchive.filter(p=>
    !pdfSearch||(p.orderNum||"").includes(pdfSearch)||(p.customerName||"").includes(pdfSearch)||(p.table||"").includes(pdfSearch)
  ),[pdfArchive,pdfSearch]);

  const getStart=()=>{
    const d=new Date();
    if(period==="today"){d.setHours(0,0,0,0);return d}
    if(period==="week"){d.setDate(d.getDate()-7);return d}
    if(period==="month"){d.setDate(1);d.setHours(0,0,0,0);return d}
    return new Date(0);
  };

  const start=getStart();
  const pOrders=store.orders.filter(o=>new Date(o.createdAt)>=start);
  const paidOrders=pOrders.filter(o=>o.status==="paid"&&new Date(o.paidAt||o.createdAt)>=start);
  const revenue=paidOrders.reduce((s,o)=>s+o.total,0);
  const expenses=(store.expenses||[]).filter(e=>new Date(e.date)>=start).reduce((s,e)=>s+e.amount,0);
  const netProfit=revenue-expenses;
  const cancelled=pOrders.filter(o=>o.status==="cancelled").length;
  const debtsTotal=pOrders.filter(o=>o.status==="debt").reduce((s,o)=>s+o.total,0);
  const avgOrder=paidOrders.length>0?Math.round(revenue/paidOrders.length):0;

  const catRevenue={hot_drinks:0,cold_drinks:0,food:0,hookah:0};
  paidOrders.forEach(o=>o.items.forEach(i=>{
    const m=store.menu.find(x=>x.id===i.itemId);
    if(m) catRevenue[m.category]=(catRevenue[m.category]||0)+i.price*i.qty;
  }));

  const itemStats={};
  paidOrders.forEach(o=>o.items.forEach(i=>{
    if(!itemStats[i.itemId]) itemStats[i.itemId]={name:i.itemName,emoji:i.emoji,qty:0,revenue:0};
    itemStats[i.itemId].qty+=i.qty;itemStats[i.itemId].revenue+=i.price*i.qty;
  }));
  const topItems=Object.values(itemStats).sort((a,b)=>b.qty-a.qty).slice(0,8);
  const catMax=Math.max(...Object.values(catRevenue),1);

  const printReport=()=>{
    const periodLabel=period==="today"?"اليوم":period==="week"?"الأسبوع":period==="month"?"الشهر":"الكل";
    const html=`<html dir="rtl"><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:20px;direction:rtl}h1{color:#c62828}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:right}th{background:#f5f5f5}.pos{color:#2e7d32}.neg{color:#c62828}</style></head><body>
    <h1>☕ ${settings?.cafeName||"Nardeen Caffe"} — تقرير المبيعات</h1>
    <p>${settings?.signature||"بإدارة يحيى داؤود"} | ${new Date().toLocaleDateString("ar-SY")}</p>
    <h3>الفترة: ${periodLabel}</h3>
    <table><tr><th>البند</th><th>القيمة</th></tr>
    <tr><td>إجمالي الإيرادات</td><td class="pos">${revenue.toLocaleString()} ${CUR}</td></tr>
    <tr><td>إجمالي المصاريف</td><td class="neg">${expenses.toLocaleString()} ${CUR}</td></tr>
    <tr><td>صافي الربح</td><td class="${netProfit>=0?"pos":"neg"}">${netProfit.toLocaleString()} ${CUR}</td></tr>
    <tr><td>طلبات مدفوعة</td><td>${paidOrders.length}</td></tr>
    <tr><td>متوسط قيمة الطلب</td><td>${avgOrder.toLocaleString()} ${CUR}</td></tr>
    <tr><td>ملغاة</td><td>${cancelled}</td></tr>
    <tr><td>ديون</td><td>${debtsTotal.toLocaleString()} ${CUR}</td></tr>
    ${Object.entries(catRevenue).map(([c,r])=>`<tr><td>${CAT_LABELS[c]}</td><td>${r.toLocaleString()} ${CUR}</td></tr>`).join("")}
    </table>
    <h3>أكثر المبيعات</h3>
    <table><tr><th>الصنف</th><th>الكمية</th><th>الإيراد</th></tr>
    ${topItems.map(i=>`<tr><td>${i.emoji} ${i.name}</td><td>${i.qty}</td><td>${i.revenue.toLocaleString()} ${CUR}</td></tr>`).join("")}
    </table></body></html>`;
    const w=window.open("","_blank","width=700,height=600");
    if(w){w.document.write(html);w.document.close();w.print();}
  };

  return(
    <div className="fade-in">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <h2 style={{fontSize:18,fontWeight:900}}>📈 التقارير</h2>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-ghost" onClick={()=>exportToExcel(store.orders,store.menu)} style={{fontSize:12,padding:"8px 12px"}}>📊 Excel</button>
          <button className="btn btn-ghost" onClick={printReport} style={{fontSize:12,padding:"8px 12px"}}>🖨 طباعة</button>
        </div>
      </div>
      {/* Sub-tabs */}
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {[["summary","📊 الملخص"],["orders_pdf","🧾 أرشيف الفواتير"]].map(([v,l])=>(
          <button key={v} onClick={()=>setReportTab(v)} style={{padding:"8px 20px",borderRadius:20,border:"none",
            background:reportTab===v?"#c62828":"var(--card2)",color:reportTab===v?"#fff":"var(--sub)",fontWeight:700,fontSize:13}}>
            {l}
          </button>
        ))}
      </div>

      {/* PDF Archive */}
      {reportTab==="orders_pdf"&&(
        <div className="fade-in">
          <input className="input" placeholder="🔍 بحث بالرقم أو الزبون أو الطاولة..." value={pdfSearch} onChange={e=>setPdfSearch(e.target.value)} style={{marginBottom:14}}/>
          {!filteredPdfs.length?(
            <div style={{textAlign:"center",padding:60,color:"var(--sub)"}}>
              <div style={{fontSize:48}}>🧾</div>
              <div style={{marginTop:10}}>لا توجد فواتير محفوظة بعد</div>
              <div style={{fontSize:12,marginTop:6}}>تُحفظ كل فاتورة تلقائياً عند الدفع أو استيفاء الدين</div>
            </div>
          ):(
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
              {filteredPdfs.map((p,i)=>(
                <div key={p.id||i} className="card" style={{borderRight:`4px solid ${p.isDebt?"#6a1b9a":"#1565c0"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontWeight:900,fontSize:14}}>🧾 #{p.orderNum}</span>
                    {p.isDebt&&<span style={{background:"rgba(106,27,154,.15)",color:"#6a1b9a",fontSize:10,padding:"2px 8px",borderRadius:6,fontWeight:700}}>💳 دين</span>}
                    {p.table&&<span style={{background:"rgba(21,101,192,.12)",color:"#1565c0",fontSize:10,padding:"2px 8px",borderRadius:6,fontWeight:700}}>🪑 {p.table}</span>}
                  </div>
                  <div style={{fontWeight:800,fontSize:13,color:"#1565c0",marginBottom:3}}>👤 {p.customerName||"—"}</div>
                  {p.paidByName&&<div style={{fontSize:11,color:"var(--sub)",marginBottom:4}}>💰 استلمه: {p.paidByName}</div>}
                  <div style={{fontSize:11,color:"var(--sub)",marginBottom:8}}>
                    {new Date(p.createdAt).toLocaleString("ar-SY",{hour:"2-digit",minute:"2-digit",month:"short",day:"numeric"})}
                  </div>
                  <div style={{fontWeight:900,color:"#c62828",fontSize:15,marginBottom:10}}>{(p.total||0).toLocaleString()} {CUR}</div>
                  <button onClick={()=>openPdfArchive(p.html)}
                    style={{width:"100%",background:"#1565c0",color:"#fff",border:"none",borderRadius:8,padding:"9px",fontWeight:700,fontSize:12}}>
                    👁 عرض وطباعة
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {reportTab==="summary"&&(<>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {[["today","اليوم"],["week","الأسبوع"],["month","الشهر"],["all","الكل"]].map(([v,l])=>(
          <button key={v} onClick={()=>setPeriod(v)} style={{padding:"7px 16px",borderRadius:20,border:"none",
            background:period===v?"#c62828":"var(--card2)",color:period===v?"#fff":"var(--sub)",fontWeight:700,fontSize:12}}>
            {l}
          </button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:18}}>
        {[["💰","الإيرادات",`${revenue.toLocaleString()} ${CUR}`,"#c62828"],
          ["📒","المصاريف",`${expenses.toLocaleString()} ${CUR}`,"#e65100"],
          ["💹","صافي الربح",`${netProfit.toLocaleString()} ${CUR}`,netProfit>=0?"#2e7d32":"#c62828"],
          ["✅","طلبات مدفوعة",paidOrders.length,"#2e7d32"],
          ["📊","متوسط الطلب",`${avgOrder.toLocaleString()} ${CUR}`,"#1976d2"],
          ["💳","ديون",`${debtsTotal.toLocaleString()} ${CUR}`,"#6a1b9a"],
        ].map(([icon,label,val,color])=>(
          <div key={label} className="card" style={{textAlign:"center",borderTop:`3px solid ${color}`}}>
            <div style={{fontSize:22,marginBottom:4}}>{icon}</div>
            <div style={{fontSize:11,color:"var(--sub)"}}>{label}</div>
            <div style={{fontSize:14,fontWeight:900,color}}>{val}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{marginBottom:16}}>
        <h3 style={{fontSize:14,fontWeight:800,marginBottom:14}}>📊 الإيرادات بالفئة</h3>
        {Object.entries(catRevenue).map(([cat,rev])=>(
          <div key={cat} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:13}}>
              <span style={{fontWeight:700}}>{CAT_LABELS[cat]}</span>
              <span style={{fontWeight:700,color:"#c62828"}}>{rev.toLocaleString()} {CUR}</span>
            </div>
            <div style={{height:8,background:"var(--border)",borderRadius:4}}>
              <div style={{height:"100%",width:`${(rev/catMax)*100}%`,background:"#c62828",borderRadius:4,transition:"width .5s"}}/>
            </div>
          </div>
        ))}
      </div>
      {topItems.length>0&&(
        <div className="card">
          <h3 style={{fontSize:14,fontWeight:800,marginBottom:14}}>🏆 أكثر المبيعات</h3>
          {topItems.map((item,i)=>(
            <div key={item.name} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",
              borderBottom:i<topItems.length-1?"1px solid var(--border)":"none"}}>
              <span style={{fontSize:10,fontWeight:800,color:"var(--sub)",minWidth:18}}>#{i+1}</span>
              <span style={{fontSize:20}}>{item.emoji}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600}}>{item.name}</div>
                <div style={{fontSize:11,color:"var(--sub)"}}>{item.qty} وحدة مباعة</div>
              </div>
              <span style={{fontWeight:700,color:"#c62828",fontSize:12}}>{item.revenue.toLocaleString()} {CUR}</span>
            </div>
          ))}
        </div>
      )}
      </>)}
    </div>
  );
}

// ═══════════════════════════════════
// SETTINGS TAB (Admin) — زر الإعدادات
// ═══════════════════════════════════
function SettingsTab({store,showToast,dm,user}){
  const isAdmin=user?.role==="admin";
  const [form,setForm]=useState({...store.settings});

  const save=()=>{
    store.setSettings(form);
    showToast("تم حفظ الإعدادات ✓");
  };

  const S=({label,children})=>(
    <div style={{marginBottom:18}}>
      <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:7,display:"block"}}>{label}</label>
      {children}
    </div>
  );

  return(
    <div className="fade-in">
      <h2 style={{fontSize:18,fontWeight:900,marginBottom:20}}>⚙ الإعدادات</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:20}}>

        {/* General */}
        <div className="card">
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:16,color:"#c62828"}}>🏪 إعدادات الكافيه</h3>
          <S label="اسم الكافيه">
            <input className="input" value={form.cafeName||""} onChange={e=>setForm(f=>({...f,cafeName:e.target.value}))}/>
          </S>
          <S label="التوقيع / الإدارة">
            <input className="input" value={form.signature||""} onChange={e=>setForm(f=>({...f,signature:e.target.value}))}/>
          </S>
          <S label="رمز العملة">
            <input className="input" value={form.currency||""} onChange={e=>setForm(f=>({...f,currency:e.target.value}))}/>
          </S>
          <S label="نسبة الضريبة %">
            <input className="input" type="number" min="0" max="100" value={form.taxPercent||0} onChange={e=>setForm(f=>({...f,taxPercent:+e.target.value}))}/>
          </S>
          <S label="🎨 ثيم التطبيق">
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {[["default","🔴 أحمر"],["green","🟢 أخضر"],["purple","🟣 بنفسجي"],["blue","🔵 أزرق"],["gold","🟡 ذهبي"]].map(([v,l])=>(
                <button key={v} onClick={()=>setForm(f=>({...f,appTheme:v}))}
                  style={{padding:"8px 14px",borderRadius:10,border:"none",fontWeight:700,fontSize:12,
                    cursor:"pointer",background:(form.appTheme||"default")===v?"var(--red)":"var(--card2)",
                    color:(form.appTheme||"default")===v?"#fff":"var(--sub)",transition:"all .2s"}}>
                  {l}
                </button>
              ))}
            </div>
          </S>
          <S label="🔑 رمز الكاشير للزبون">
            <input className="input" placeholder="narden" value={form.cashierCode||""} 
              onChange={e=>setForm(f=>({...f,cashierCode:e.target.value}))}
              style={{fontFamily:"monospace",letterSpacing:2}}/>
            <div style={{fontSize:11,color:"var(--sub)",marginTop:4}}>
              الرمز الذي يدخله الزبون عند إرسال الطلب — اتركه فارغاً لاستخدام narden
            </div>
          </S>
          <S label="لغة واجهة الزبون / Customer Language">
            <div style={{display:"flex",gap:10}}>
              {[["ar","🇸🇦 عربي"],["en","🇬🇧 English"]].map(([v,l])=>(
                <button key={v} onClick={()=>setForm(f=>({...f,appLang:v}))}
                  style={{flex:1,padding:"10px 0",borderRadius:12,border:"none",
                    fontWeight:700,fontSize:14,cursor:"pointer",
                    background:(form.appLang||"ar")===v?"#c62828":"var(--card2)",
                    color:(form.appLang||"ar")===v?"#fff":"var(--sub)",
                    transition:"all .2s"}}>
                  {l}
                </button>
              ))}
            </div>
          </S>
        </div>

        {/* Notification Settings */}
        <div className="card">
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:16,color:"#2e7d32"}}>🔔 إعدادات الإشعارات</h3>
          {[
            ["notifSound","🔊 أصوات الإشعارات","تشغيل نغمة لكل إشعار (دفع، دين، طلب جديد)"],
            ["notifOrders","📋 إشعار عند طلب جديد","إظهار إشعار فوري عند ورود أي طلب"],
            ["notifReady","✅ إشعار عند جاهز","إشعار عند تحضير الطلب"],
          ].map(([key,label,desc])=>(
            <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              marginBottom:14,padding:"12px 14px",background:"var(--card2)",borderRadius:12}}>
              <div>
                <div style={{fontWeight:700,fontSize:13}}>{label}</div>
                <div style={{fontSize:11,color:"var(--sub)",marginTop:2}}>{desc}</div>
              </div>
              <button onClick={()=>setForm(f=>({...f,[key]:f[key]===false?true:false}))}
                style={{width:48,height:26,borderRadius:13,border:"none",position:"relative",flexShrink:0,
                  background:form[key]===false?"var(--border)":"#2e7d32",transition:"background .3s",cursor:"pointer"}}>
                <div style={{position:"absolute",top:3,left:form[key]===false?23:3,width:20,height:20,
                  borderRadius:"50%",background:"#fff",transition:"left .3s",boxShadow:"0 2px 4px rgba(0,0,0,.2)"}}/>
              </button>
            </div>
          ))}
        </div>

        {/* Permissions */}
        <div className="card">
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:16,color:"#1565c0"}}>🔐 الصلاحيات</h3>
          <S label="الحد الأقصى للخصم (كاشير / عامل) %">
            <input className="input" type="number" min="0" max="100" value={form.maxDiscount??50} onChange={e=>setForm(f=>({...f,maxDiscount:+e.target.value}))}/>
          </S>
          {[
            ["workerCanDecreaseStock","يمكن للموظفين تخفيض المخزون يدوياً"],
            ["cashierCanSeeReports","يمكن للكاشير مشاهدة التقارير"],
            ["allowCustomerOrders","السماح بطلبات الزبائن (واجهة الزبون)"],
          ].map(([key,label])=>(
            <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,padding:"10px 14px",background:"var(--card2)",borderRadius:10}}>
              <span style={{fontSize:13,fontWeight:600}}>{label}</span>
              <button onClick={()=>setForm(f=>({...f,[key]:!f[key]}))}
                style={{width:48,height:26,borderRadius:13,border:"none",position:"relative",
                  background:form[key]?"#c62828":"var(--border)",transition:"background .3s",cursor:"pointer"}}>
                <div style={{position:"absolute",top:3,left:form[key]?3:23,width:20,height:20,
                  borderRadius:"50%",background:"#fff",transition:"left .3s",boxShadow:"0 2px 4px rgba(0,0,0,.2)"}}/>
              </button>
            </div>
          ))}
        </div>

        {/* Role Permissions Table */}
        <div className="card" style={{gridColumn:"1/-1"}}>
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:16,color:"#6a1b9a"}}>👥 صلاحيات الأقسام</h3>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:"var(--card2)"}}>
                  <th style={{padding:"10px 14px",textAlign:"right",fontWeight:700}}>القسم</th>
                  {Object.entries(ROLE_LABELS).filter(([v])=>v!==ROLES.CUSTOMER).map(([r,l])=>(
                    <th key={r} style={{padding:"10px 12px",fontWeight:700,color:ROLE_COLORS[r],whiteSpace:"nowrap"}}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(PERMISSIONS).filter(([s])=>!["customer_home","myorders"].includes(s)).map(([section,roles])=>(
                  <tr key={section} style={{borderBottom:"1px solid var(--border)"}}>
                    <td style={{padding:"8px 14px",fontWeight:600}}>
                      {["dashboard","order","orders","cashier","debts","expenses","bar","hookah","menu","tables","staff","reports","settings"][
                        ["dashboard","order","orders","cashier","debts","expenses","bar","hookah","menu","tables","staff","reports","settings"].indexOf(section)
                      ]||section}
                    </td>
                    {Object.keys(ROLE_LABELS).filter(r=>r!==ROLES.CUSTOMER).map(r=>(
                      <td key={r} style={{padding:"8px 12px",textAlign:"center"}}>
                        {roles.includes(r)
                          ?<span style={{color:"#2e7d32",fontSize:16}}>✓</span>
                          :<span style={{color:"var(--border)",fontSize:14}}>—</span>
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{fontSize:11,color:"var(--sub)",marginTop:10}}>* لتخصيص الصلاحيات بشكل أعمق، تواصل مع مطور التطبيق.</p>

      {isAdmin&&(
        <div className="card" style={{borderTop:"4px solid #c62828",marginTop:16}}>
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:14,color:"#c62828"}}>⚠️ منطقة الأدمن — تصفير</h3>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <button onClick={()=>{if(window.confirm("تصفير جميع الطلبات والمبيعات؟ لا يمكن التراجع!")){store.setOrders([]);store.setCashLog([]);showToast("تم تصفير المبيعات","warn");}}}
              style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#c62828",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
              🗑️ تصفير المبيعات
            </button>
            <button onClick={()=>{if(window.confirm("تصفير جميع الديون؟")){store.setDebts([]);showToast("تم تصفير الديون","warn");}}}
              style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#6a1b9a",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
              🗑️ تصفير الديون
            </button>
            <button onClick={()=>{if(window.confirm("تصفير المصاريف؟")){store.setExpenses([]);showToast("تم تصفير المصاريف","warn");}}}
              style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#e65100",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
              🗑️ تصفير المصاريف
            </button>
          </div>
        </div>
      )}
        </div>
      </div>

      <div style={{marginTop:24,display:"flex",justifyContent:"flex-end"}}>
        <button className="btn btn-red" onClick={save} style={{padding:"12px 32px",fontSize:15}}>
          💾 حفظ الإعدادات
        </button>
      </div>
    </div>
  );
}
