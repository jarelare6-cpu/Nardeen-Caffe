// شاشات الزبون والدخول — مفصولة من App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore, checkSessionExpiry, touchSession, getNextInvoiceNum } from "./lib/store.js";
import { SUPABASE_READY, sbDeleteAll, sbDelete, sbUpsert, sbFetch } from "./lib/supabase.js";
import OutdoorScreen from "./OutdoorScreen.jsx";
import { playOrderAlert, exportToExcel, generateTableQR, checkStockAlerts, notifyLowStock, sendReceiptWhatsApp, printKitchenTicket, getLoyaltyStatus, calcLoyaltyDiscount, getPartialPaymentStatus, getStaffReport, getPeakHoursData, getSalesComparison, calcShiftSummary, getOrderUrgency, getAvgPrepTime, calcEarnedPoints, getCustomerTier, pointsToValue, verifyPassword } from "./lib/utils.js";
import { ROLES, ROLE_LABELS, ROLE_COLORS, ORDER_STATUS, STATUS_LABELS, STATUS_COLORS, CAT_LABELS, CAT_ORDER, BAR_CATS, HOOKAH_CATS, STATION_CATS, PERMISSIONS, THEMES, catOf, orderFullyPrepared, canAccess } from "./constants.js";
import { ItemVisual, BottomNav, GlobalStyle, Toast, PWABanner, OrderTimer } from "./uikit.jsx";
import { printOrder, generateReceiptPDF, saveReceiptRecord, saveReceipt } from "./receipts.js";
import { NardeenLogoIcon, CustomerIcon, StaffIcon } from "./NardeenIcons.jsx";

export function LoginScreen({store,onLogin,showToast,dm}){
  const [mode,setMode]=useState("choose");
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [showPass,setShowPass]=useState(false);
  const [error,setError]=useState("");
  const [shake,setShake]=useState(false);

  const doLogin=async()=>{
    setError("");
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

  const cafeName=store.settings?.cafeName||"Nardeen Café";
  const sig=store.settings?.signature||"بإدارة يحيى داؤود";

  return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20,
      background:dm?"#0d0d18":"linear-gradient(160deg,#1a0000 0%,#6b0000 40%,#8B0E1A 70%,#c62828 100%)",
      position:"relative",overflow:"hidden"}}>

      {/* خلفية زخرفية */}
      <div style={{position:"absolute",inset:0,pointerEvents:"none",overflow:"hidden"}}>
        {/* دوائر خلفية */}
        <div style={{position:"absolute",top:-120,right:-80,width:380,height:380,
          borderRadius:"50%",border:"1px solid rgba(212,160,23,0.08)",opacity:0.6}}/>
        <div style={{position:"absolute",top:-60,right:-30,width:220,height:220,
          borderRadius:"50%",border:"1px solid rgba(212,160,23,0.12)"}}/>
        <div style={{position:"absolute",bottom:-100,left:-60,width:300,height:300,
          borderRadius:"50%",border:"1px solid rgba(212,160,23,0.06)"}}/>
        {/* نقاط ذهبية صغيرة */}
        {[...Array(6)].map((_,i)=>(
          <div key={i} style={{
            position:"absolute",
            top:`${15+i*14}%`, left:`${8+i*13}%`,
            width:3, height:3, borderRadius:"50%",
            background:"rgba(212,160,23,0.3)",
            animation:`twinkle ${2+i*0.4}s ease-in-out infinite alternate`
          }}/>
        ))}
        {/* زخرفة ورق */}
        <svg style={{position:"absolute",bottom:0,left:0,opacity:0.05}} viewBox="0 0 200 200" width={200} height={200}>
          <path d="M100 10 Q130 50 100 90 Q70 130 100 170 Q130 130 100 90 Q70 50 100 10Z" fill="#D4A017"/>
          <path d="M50 50 Q90 80 50 110 Q10 80 50 50Z" fill="#D4A017"/>
          <path d="M150 50 Q110 80 150 110 Q190 80 150 50Z" fill="#D4A017"/>
        </svg>
        <svg style={{position:"absolute",top:20,right:20,opacity:0.06}} viewBox="0 0 120 120" width={120} height={120}>
          <path d="M60 5 Q75 30 60 55 Q45 80 60 105 Q75 80 60 55 Q45 30 60 5Z" fill="#D4A017"/>
          <path d="M20 35 Q45 50 20 65 Q5 50 20 35Z" fill="#D4A017"/>
          <path d="M100 35 Q75 50 100 65 Q115 50 100 35Z" fill="#D4A017"/>
        </svg>
      </div>

      <style>{`
        @keyframes shakeX{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-10px)}40%,80%{transform:translateX(10px)}}
        @keyframes floatUp{0%{opacity:0;transform:translateY(30px)}100%{opacity:1;transform:translateY(0)}}
        @keyframes logoFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes twinkle{0%{opacity:0.2}100%{opacity:0.8}}
        @keyframes goldShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
        .nd-role-card{
          background:rgba(255,255,255,0.06);
          border:1.5px solid rgba(212,160,23,0.2);
          border-radius:20px;padding:28px 16px;cursor:pointer;
          transition:all .35s cubic-bezier(0.4,0,0.2,1);text-align:center;
          backdrop-filter:blur(12px);position:relative;overflow:hidden;
        }
        .nd-role-card::before{
          content:"";position:absolute;inset:0;
          background:linear-gradient(135deg,rgba(212,160,23,0.0),rgba(212,160,23,0.08));
          opacity:0;transition:opacity .3s;
        }
        .nd-role-card:hover{
          background:rgba(255,255,255,0.12);
          border-color:rgba(212,160,23,0.6);
          transform:translateY(-5px);
          box-shadow:0 16px 40px rgba(0,0,0,.5),0 0 20px rgba(212,160,23,0.15);
        }
        .nd-role-card:hover::before{opacity:1}
        .nd-divider{
          display:flex;align-items:center;gap:10;margin:20px 0;
        }
        .nd-divider::before,.nd-divider::after{
          content:"";flex:1;height:1px;background:rgba(212,160,23,0.2);
        }
        .nd-input{
          width:100%;padding:12px 16px;border-radius:12px;font-size:14px;
          font-family:inherit;outline:none;transition:all .2s;
          background:rgba(255,255,255,0.08);
          color:#fff;
          border:1.5px solid rgba(212,160,23,0.25);
        }
        .nd-input:focus{
          border-color:rgba(212,160,23,0.7);
          background:rgba(255,255,255,0.12);
          box-shadow:0 0 0 3px rgba(212,160,23,0.1);
        }
        .nd-input::placeholder{color:rgba(255,255,255,0.35)}
        .nd-btn-gold{
          background:linear-gradient(135deg,#D4A017,#b8860b,#D4A017);
          background-size:200% 100%;
          border:none;border-radius:12px;padding:13px;
          font-size:15px;font-weight:800;color:#1a0a00;
          cursor:pointer;width:100%;font-family:inherit;
          transition:all .3s;
          box-shadow:0 4px 20px rgba(212,160,23,0.4);
          animation:goldShimmer 3s linear infinite;
        }
        .nd-btn-gold:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(212,160,23,0.6)}
      `}</style>

      <div style={{width:"100%",maxWidth:420,animation:"floatUp .5s ease",position:"relative",zIndex:1}}>

        {/* ── شعار ناردين ── */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{
            width:110,height:110,
            background:"linear-gradient(135deg,rgba(139,14,26,0.6),rgba(26,0,0,0.8))",
            border:"2px solid rgba(212,160,23,0.5)",
            borderRadius:"50%",
            display:"flex",alignItems:"center",justifyContent:"center",
            margin:"0 auto 18px",
            boxShadow:"0 12px 40px rgba(0,0,0,.6),0 0 30px rgba(212,160,23,0.15)",
            backdropFilter:"blur(10px)",
            animation:"logoFloat 3s ease-in-out infinite"
          }}>
            <NardeenLogoIcon size={72} gold="#D4A017" glow={true} />
          </div>
          {/* اسم الكافيه بخط عريض */}
          <div style={{
            fontSize:30,fontWeight:900,color:"#fff",
            marginBottom:3,letterSpacing:"0.5px",
            textShadow:"0 2px 20px rgba(0,0,0,.6)"
          }}>
            {cafeName}
          </div>
          {/* الخط الذهبي الفاصل */}
          <div style={{
            display:"flex",alignItems:"center",justifyContent:"center",
            gap:8,margin:"8px auto",width:200
          }}>
            <div style={{flex:1,height:1,background:"linear-gradient(to right,transparent,rgba(212,160,23,0.6))"}}/>
            <svg viewBox="0 0 16 16" width={14} height={14}>
              <path d="M8 1 L9.5 6 L15 6 L10.5 9.5 L12 15 L8 11.5 L4 15 L5.5 9.5 L1 6 L6.5 6 Z" fill="#D4A017" opacity="0.8"/>
            </svg>
            <div style={{flex:1,height:1,background:"linear-gradient(to left,transparent,rgba(212,160,23,0.6))"}}/>
          </div>
          <p style={{fontSize:13,color:"rgba(255,255,255,0.6)",letterSpacing:"0.3px"}}>{sig}</p>
        </div>

        {/* ── شاشة الاختيار ── */}
        {mode==="choose"&&(
          <div style={{animation:"floatUp .4s ease"}}>
            <p style={{textAlign:"center",color:"rgba(255,255,255,0.75)",fontSize:14,
              fontWeight:700,marginBottom:18,letterSpacing:"0.3px"}}>
              كيف تريد الدخول؟
            </p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20}}>
              {/* زبون */}
              <div className="nd-role-card" onClick={enterAsCustomer}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12}}>
                  <CustomerIcon size={56} />
                </div>
                <div style={{color:"#fff",fontWeight:900,fontSize:17,marginBottom:5}}>زبون</div>
                <div style={{color:"rgba(255,255,255,0.55)",fontSize:11,lineHeight:1.5,marginBottom:14}}>
                  تصفح القائمة وأطلب مباشرة
                </div>
                <div style={{
                  background:"linear-gradient(135deg,rgba(212,160,23,0.2),rgba(212,160,23,0.1))",
                  border:"1px solid rgba(212,160,23,0.35)",
                  borderRadius:10,padding:"8px 0",
                  color:"#D4A017",fontWeight:800,fontSize:13
                }}>
                  دخول فوري ←
                </div>
              </div>

              {/* موظف */}
              <div className="nd-role-card" onClick={()=>setMode("staff")}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12}}>
                  <StaffIcon size={56} />
                </div>
                <div style={{color:"#fff",fontWeight:900,fontSize:17,marginBottom:5}}>موظف</div>
                <div style={{color:"rgba(255,255,255,0.55)",fontSize:11,lineHeight:1.5,marginBottom:14}}>
                  إدارة الطلبات والعمليات
                </div>
                <div style={{
                  background:"linear-gradient(135deg,rgba(139,14,26,0.4),rgba(139,14,26,0.2))",
                  border:"1px solid rgba(198,40,40,0.4)",
                  borderRadius:10,padding:"8px 0",
                  color:"#ff8a80",fontWeight:800,fontSize:13
                }}>
                  تسجيل دخول ←
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── شاشة دخول الموظف ── */}
        {mode==="staff"&&(
          <div style={{animation:"floatUp .3s ease"}}>
            <button onClick={()=>setMode("choose")} style={{
              background:"rgba(212,160,23,0.1)",
              border:"1px solid rgba(212,160,23,0.3)",
              color:"#D4A017",borderRadius:10,padding:"7px 16px",
              fontSize:13,fontWeight:700,marginBottom:16,cursor:"pointer",
              fontFamily:"inherit",transition:"all .2s"
            }}>
              ← رجوع
            </button>

            <div style={{
              background:"rgba(255,255,255,0.05)",
              backdropFilter:"blur(16px)",
              border:"1.5px solid rgba(212,160,23,0.2)",
              borderRadius:20,padding:28,
              animation:shake?"shakeX .5s":"none",
              boxShadow:"0 20px 60px rgba(0,0,0,.4)"
            }}>
              {/* رأس النموذج */}
              <div style={{textAlign:"center",marginBottom:22}}>
                <div style={{
                  width:50,height:50,
                  background:"linear-gradient(135deg,#8B0E1A,#c62828)",
                  borderRadius:"50%",
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                  marginBottom:10,
                  boxShadow:"0 6px 20px rgba(139,14,26,0.5)"
                }}>
                  <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
                    <rect x="3" y="11" width="18" height="11" rx="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    <circle cx="12" cy="16" r="1.5" fill="#fff"/>
                  </svg>
                </div>
                <h2 style={{fontSize:17,fontWeight:900,color:"#fff",marginBottom:4}}>
                  دخول الموظفين
                </h2>
                <div style={{width:40,height:2,background:"linear-gradient(to right,transparent,#D4A017,transparent)",margin:"0 auto"}}/>
              </div>

              <div style={{marginBottom:14}}>
                <label style={{fontSize:12,fontWeight:700,color:"rgba(212,160,23,0.8)",marginBottom:7,display:"block"}}>
                  اسم المستخدم
                </label>
                <input
                  className="nd-input"
                  type="text" value={username}
                  onChange={e=>setUsername(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&doLogin()}
                  placeholder="أدخل اسم المستخدم"
                  autoComplete="username"
                />
              </div>

              <div style={{marginBottom:20}}>
                <label style={{fontSize:12,fontWeight:700,color:"rgba(212,160,23,0.8)",marginBottom:7,display:"block"}}>
                  كلمة المرور
                </label>
                <div style={{position:"relative"}}>
                  <input
                    className="nd-input"
                    type={showPass?"text":"password"} value={password}
                    onChange={e=>setPassword(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&doLogin()}
                    placeholder="أدخل كلمة المرور"
                    autoComplete="current-password"
                    style={{paddingLeft:44}}
                  />
                  <button onClick={()=>setShowPass(p=>!p)} style={{
                    position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",
                    background:"none",border:"none",cursor:"pointer",
                    color:"rgba(212,160,23,0.6)",padding:0,
                    display:"flex",alignItems:"center"
                  }}>
                    {showPass?(
                      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ):(
                      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error&&(
                <div style={{
                  background:"rgba(139,14,26,0.3)",color:"#ffcdd2",
                  borderRadius:10,padding:"10px 14px",fontSize:13,
                  marginBottom:14,fontWeight:600,
                  border:"1px solid rgba(198,40,40,0.4)",
                  display:"flex",alignItems:"center",gap:8
                }}>
                  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="#ffcdd2" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <circle cx="12" cy="16" r="1" fill="#ffcdd2"/>
                  </svg>
                  {error}
                </div>
              )}

              <button className="nd-btn-gold" onClick={doLogin}>
                دخول إلى النظام
              </button>
            </div>
          </div>
        )}

        {/* تذييل */}
        <div style={{textAlign:"center",marginTop:24}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,
            color:"rgba(212,160,23,0.4)",fontSize:11}}>
            <div style={{width:20,height:1,background:"rgba(212,160,23,0.3)"}}/>
            <span>Nardeen Café System</span>
            <div style={{width:20,height:1,background:"rgba(212,160,23,0.3)"}}/>
          </div>
        </div>
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
    {key:"hot_drinks",  label:"مشروبات ساخنة",
      icon:<svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke="#D4A017" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 2h8l1.5 4H6.5L8 2z"/><path d="M7 6 Q6 13 8 17 Q10 21 12 21 Q14 21 16 17 Q18 13 17 6"/><line x1="9" y1="11" x2="15" y2="11"/><path d="M16 9 Q19 9 19 7" strokeLinecap="round"/></svg>,
      grad:"linear-gradient(135deg,#3d1000,#7a2800,#b85520)", tag:"دفء وراحة"},
    {key:"cold_drinks", label:"مشروبات باردة",
      icon:<svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke="#60b8e0" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M8 2h8l1.5 4H6.5L8 2z"/><path d="M7 6 Q6 13 8 17 Q10 21 12 21 Q14 21 16 17 Q18 13 17 6"/><line x1="9" y1="11" x2="15" y2="11"/><path d="M14 6 L14 3" strokeLinecap="round"/><path d="M14 3 L16 1" strokeLinecap="round"/></svg>,
      grad:"linear-gradient(135deg,#003366,#0055aa,#0088cc)", tag:"منعش ولذيذ"},
    {key:"food",        label:"أكل ووجبات خفيفة",
      icon:<svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke="#6abf69" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 2 Q3 8 5 9 Q7 10 9 9 Q11 8 11 2"/><line x1="7" y1="9" x2="7" y2="22"/><path d="M13 2 Q13 6 15 8 L15 22"/><path d="M13 7 Q14.5 7.5 15 7"/><path d="M19 4 Q21 6 21 9 Q21 13 18 15 Q20 18 20 22"/></svg>,
      grad:"linear-gradient(135deg,#1a3300,#2e7d32,#4caf50)", tag:"شهي وطازج"},
    {key:"hookah",      label:"نرجيلة وأراكيل",
      icon:<svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke="#ce93d8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="17" rx="5" ry="3"/><line x1="12" y1="14" x2="12" y2="9"/><ellipse cx="12" cy="8" rx="3.5" ry="2.5"/><path d="M12 5.5 Q13 3 15 2 Q12.5 1.5 11 3 Q11.5 4 12 5.5" strokeLinecap="round"/><path d="M7 17 Q4 17 3.5 20" strokeLinecap="round"/><circle cx="3.5" cy="21" r="1" fill="#ce93d8"/></svg>,
      grad:"linear-gradient(135deg,#2d0057,#6a1b9a,#9c27b0)", tag:"تجربة استثنائية"},
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
        <div style={{fontSize:72,animation:"landFloat 3s ease-in-out infinite",marginBottom:12,
          display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{width:90,height:90,borderRadius:"50%",
            background:"linear-gradient(135deg,rgba(139,14,26,0.5),rgba(26,0,0,0.7))",
            border:"2px solid rgba(212,160,23,0.4)",
            display:"flex",alignItems:"center",justifyContent:"center",
            boxShadow:"0 8px 30px rgba(0,0,0,.5),0 0 20px rgba(212,160,23,0.1)"}}>
            <NardeenLogoIcon size={60} gold="#D4A017" glow={true} />
          </div>
        </div>
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
              <span style={{display:"inline-flex",alignItems:"center",gap:6}}>{c.icon} {c.label}</span>
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
                  <div style={{fontSize:40,marginBottom:4,display:"flex",alignItems:"center",justifyContent:"center"}}>{cat.icon}</div>
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
    setTimeout(async ()=>{
      const orderNum=await getNextInvoiceNum(store.orders); // v29: متسلسل يُصفّر يومياً
      const newOrder={
        id:(Date.now().toString(36)+Math.random().toString(36).slice(2,7)),orderNum,
        customerId:user.id,customerName:user.name,
        table:tableInput.trim(),notes,items:cart,total:cartTotal,discount:0,
        status:ORDER_STATUS.PENDING,createdAt:new Date().toISOString(),paymentStatus:"pending",
        stockDeducted:false, // v23: الخصم عند الدفع لا عند الإنشاء
      };
      store.setOrders(p=>[newOrder,...p]);
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
          <div style={{width:36,height:36,borderRadius:"50%",
            background:"rgba(0,0,0,0.2)",border:"1.5px solid rgba(212,160,23,0.35)",
            display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <NardeenLogoIcon size={24} gold="#D4A017" />
          </div>
          <div>
            <div style={{fontWeight:900,fontSize:16}}>{settings.cafeName||"Nardeen Café"}</div>
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
        {[
          ["menu", <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 2 Q3 8 5 9 Q7 10 9 9 Q11 8 11 2"/><line x1="7" y1="9" x2="7" y2="22"/><path d="M13 2 Q13 6 15 8 L15 22"/></svg>, "قائمة الطعام"],
          ["cart", <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" fill="currentColor"/><circle cx="20" cy="21" r="1" fill="currentColor"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>, `السلة${cartCount>0?` (${cartCount})`:""}` ],
          ["myorders", <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>, "طلباتي"],
        ].map(([t,icon,label])=>(
          <button key={t} onClick={()=>setTab(t)} style={{
            padding:"14px 14px",border:"none",
            background:"none",fontWeight:tab===t?800:500,
            color:tab===t?"#8B0E1A":"var(--sub)",
            fontSize:13,borderBottom:tab===t?"3px solid #8B0E1A":"3px solid transparent",
            whiteSpace:"nowrap",transition:"all .2s",
            display:"flex",alignItems:"center",gap:6
          }}>
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
                  background:cat==="all"?"#8B0E1A":"var(--card2)",color:cat==="all"?"#fff":"var(--sub)",
                  fontWeight:700,fontSize:12,whiteSpace:"nowrap",boxShadow:"var(--shadow)",
                  display:"inline-flex",alignItems:"center",gap:5}}>
                  <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> الكل
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
