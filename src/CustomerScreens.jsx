// شاشات الزبون والدخول — مفصولة من App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore, checkSessionExpiry, touchSession } from "./lib/store.js";
import { SUPABASE_READY, sbDeleteAll, sbDelete, sbUpsert, sbFetch } from "./lib/supabase.js";
import OutdoorScreen from "./OutdoorScreen.jsx";
import { playOrderAlert, exportToExcel, generateTableQR, checkStockAlerts, notifyLowStock, sendReceiptWhatsApp, printKitchenTicket, getLoyaltyStatus, calcLoyaltyDiscount, getPartialPaymentStatus, getStaffReport, getPeakHoursData, getSalesComparison, calcShiftSummary, getOrderUrgency, getAvgPrepTime, calcEarnedPoints, getCustomerTier, pointsToValue, verifyPassword } from "./lib/utils.js";
import { ROLES, ROLE_LABELS, ROLE_COLORS, ORDER_STATUS, STATUS_LABELS, STATUS_COLORS, CAT_LABELS, CAT_ORDER, BAR_CATS, HOOKAH_CATS, STATION_CATS, PERMISSIONS, THEMES, catOf, orderFullyPrepared, canAccess } from "./constants.js";
import { ItemVisual, BottomNav, GlobalStyle, Toast, PWABanner, OrderTimer } from "./uikit.jsx";
import { printOrder, generateReceiptPDF, saveReceiptRecord, saveReceipt } from "./receipts.js";

export function LoginScreen({store,onLogin,showToast,dm}){
  const [mode,setMode]=useState("choose"); // "choose" | "staff" | "customer"
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [showPass,setShowPass]=useState(false);
  const [error,setError]=useState("");
  const [shake,setShake]=useState(false);

  const doLogin=async()=>{
    setError("");
    // التحقق من النسخة المحلية للمستخدمين (يعمل أوفلاين) — verifyPassword من الحزمة الرئيسية
    const candidates = store.users.filter(x=>x.username===username&&x.active);
    let u = null;
    for(const c of candidates){
      const ok = await verifyPassword(password, c.password);
      if(ok){ u=c; break; }
    }
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

export function CustomerLanding({store,onEnter,onLogout,dm}){
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
                    <div style={{marginBottom:8,minHeight:48,display:"flex",alignItems:"center",justifyContent:"center"}}><ItemVisual item={item} size={48} round={14}/></div>
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


export function CustomerPortal({user,store,onLogout,showToast,addNotification,dm}){
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
      const _dt=(()=>{try{let t=localStorage.getItem("nc_dev_tag");if(!t){t=String.fromCharCode(65+Math.floor(Math.random()*26));localStorage.setItem("nc_dev_tag",t);}return t;}catch{return "X";}})();
      const orderNum=_dt+"-"+(store.orders.length+1).toString().padStart(4,"0");
      const newOrder={
        id:(Date.now().toString(36)+Math.random().toString(36).slice(2,7)),orderNum,
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
                        <div key={item.id} onClick={()=>addToCart(item)} className="order-item-card"
                          style={{background:"var(--card)",borderRadius:14,padding:14,cursor:"pointer",
                            transition:"all .2s",boxShadow:inCart?"0 0 0 2.5px #c62828,var(--shadow)":"var(--shadow)",
                            transform:inCart?"scale(1.03)":"scale(1)",position:"relative",userSelect:"none"}}>
                          <div style={{marginBottom:8,minHeight:42,display:"flex",alignItems:"center",justifyContent:"center"}}><ItemVisual item={item} size={42} round={12}/></div>
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
                    <ItemVisual item={store.menu.find(m=>m.id===item.itemId)||item} size={46} round={12}/>
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
                    <ItemVisual item={store.menu.find(m=>m.id===i.itemId)||i} size={18} round={5}/> {i.itemName} ×{i.qty} — {(i.price*i.qty).toLocaleString()} {CUR}
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
                  <span style={{display:"inline-flex",alignItems:"center",gap:6}}><ItemVisual item={store.menu.find(m=>m.id===c.itemId)||c} size={20} round={6}/>{c.itemName} ×{c.qty}</span>
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
