// مكوّنات واجهة صغيرة مشتركة — مفصولة من App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo, useContext, createContext } from "react";
import { THEMES, ROLES } from "./constants.js";

// النمط العام للصور: "real" (افتراضي) أو "icon" — يتحكّم به زر التبديل
export const ImageStyleContext = createContext("real");

export function ItemVisual({ item, size = 40, round = 12 }) {
  const style = useContext(ImageStyleContext);
  const real = (item?.image || "").trim();
  const icon = (item?.imageIcon || "").trim();
  const img = style === "icon" ? (icon || real) : (real || icon);
  const emoji = item?.emoji || "🍽";
  if (img) {
    return (
      <span style={{ display: "inline-block" }}>
        <img
          src={img}
          alt={item?.name || ""}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
            const ph = e.currentTarget.nextSibling;
            if (ph) ph.style.display = "block";
          }}
          style={{ width: size, height: size, objectFit: "cover", borderRadius: round, display: "block", margin: "0 auto" }}
        />
        <span style={{ display: "none", fontSize: Math.round(size * 0.8) }}>{emoji}</span>
      </span>
    );
  }
  return <span style={{ display: "inline-block", fontSize: Math.round(size * 0.8) }}>{emoji}</span>;
}

// ── Phase ب: شريط التنقّل السفلي اللمسي ──────────────────────

export function BottomNav({ navItems, tab, setTab, role }) {
  const [showMore, setShowMore] = useState(false);
  const adminPrimary = ["dashboard", "outdoor_admin", "menu", "bar"];
  let primary, rest;
  if (role === "admin") {
    primary = adminPrimary.map(k => navItems.find(([t]) => t === k)).filter(Boolean);
    rest = navItems.filter(([t]) => !adminPrimary.includes(t));
  } else if (navItems.length <= 5) {
    primary = navItems; rest = [];
  } else {
    primary = navItems.slice(0, 4); rest = navItems.slice(4);
  }
  const go = (t) => { setTab(t); setShowMore(false); };
  const moreActive = rest.some(([t]) => t === tab);
  return (
    <>
      {showMore && (
        <div className="bn-sheet-overlay" onClick={e => { if (e.target === e.currentTarget) setShowMore(false); }}>
          <div className="bn-sheet">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 800 }}>كل الأقسام</h3>
              <button onClick={() => setShowMore(false)}
                style={{ border: "none", background: "var(--card2)", borderRadius: 10, width: 34, height: 34, fontSize: 16, cursor: "pointer", color: "var(--text)" }}>✕</button>
            </div>
            <div className="bn-grid">
              {navItems.map(([t, icon, label]) => (
                <button key={t} className={tab === t ? "active" : ""} onClick={() => go(t)}>
                  <span className="bn-ic">{icon}</span>
                  <span className="bn-lb">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="bottom-nav" role="navigation">
        {primary.map(([t, icon, label]) => (
          <button key={t} className={"bn-cell" + (tab === t ? " active" : "")} onClick={() => go(t)}>
            <span className="bn-ic">{icon}</span>
            <span className="bn-lb">{label}</span>
          </button>
        ))}
        {rest.length > 0 && (
          <button className={"bn-cell" + (moreActive ? " active" : "")} onClick={() => setShowMore(true)}>
            <span className="bn-ic">⋯</span>
            <span className="bn-lb">المزيد</span>
          </button>
        )}
      </div>
    </>
  );
}

// Permissions per role

export const GlobalStyle = ({dm,theme="default"}) => {
  const t = THEMES[theme]||THEMES.default;
  return (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;900&family=El+Messiri:wght@500;600;700&family=Cairo:wght@400;600;700;900&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    :root{
      --red:${t.primary};--red-dark:${t.secondary};--green:#2e7d32;--gold:${t.accent};
      --bg:${dm?"#0b0b16":"#f7eee8"};
      --grad-bg:${dm
        ? "radial-gradient(1100px 620px at 88% -8%,rgba(198,40,40,.30),transparent 58%),radial-gradient(900px 560px at -8% 6%,rgba(21,101,192,.26),transparent 55%),linear-gradient(160deg,#0b0b16,#12132c 60%,#0b0b16)"
        : "radial-gradient(1000px 560px at 92% -6%,rgba(198,40,40,.32),transparent 55%),radial-gradient(820px 520px at -6% 4%,rgba(245,166,35,.26),transparent 55%),linear-gradient(160deg,#fbf2ec,#eef1fb 58%,#fbeee7)"};
      --card-surface:${dm
        ? "linear-gradient(160deg,#1b1d36,#15172b)"
        : "linear-gradient(160deg,#ffffff,#fdf4ee)"};
      --card:${dm?"#181a30":"#ffffff"};
      --card2:${dm?"#20223c":"#eef1f9"};
      --border:${dm?"#2f3358":"#d7dcef"};
      --text:${dm?"#eceeff":"#161830"};
      --sub:${dm?"#9097c4":"#5b6480"};
      --shadow:${dm?"0 4px 24px rgba(0,0,0,.5)":"0 4px 20px rgba(40,55,110,.12)"};
      --shadow-lg:${dm?"0 16px 44px rgba(0,0,0,.6)":"0 16px 40px rgba(40,55,110,.22)"};
      --grad-primary:linear-gradient(135deg,${t.primary},${t.secondary});
      --grad-accent:linear-gradient(135deg,${t.accent},${t.primary});
      --glow:0 0 0 3px ${t.primary}40;
      --ring:${t.primary};
      --sp-1:6px;--sp-2:10px;--sp-3:14px;--sp-4:20px;--sp-5:28px;
      --radius:14px;--radius-sm:10px;--radius-lg:20px;
    }
    body{font-family:'Tajawal',sans-serif;direction:rtl;background:var(--bg);background-image:var(--grad-bg);background-attachment:fixed;color:var(--text);overflow-x:hidden;-webkit-font-smoothing:antialiased}
    ${theme==="dark"?":root{--bg:#080810;--card:#0e0e1a;--card2:#141420;--border:#1e1e2e;--text:#e8eaf6;--sub:#7070a0;--shadow:0 4px 24px rgba(0,0,0,.7);}":""}
    button{cursor:pointer;font-family:inherit;direction:rtl}
    input,select,textarea{font-family:inherit;direction:rtl;background:var(--card);color:var(--text)}
    .card{background:var(--card-surface);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px;border:1px solid ${dm?"rgba(255,255,255,.06)":"rgba(40,55,110,.06)"};transition:transform .25s cubic-bezier(.2,.7,.3,1),box-shadow .25s ease}
    .card.hoverable:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg)}
    .input{width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:14px;outline:none;transition:border .2s,box-shadow .2s;background:var(--card);color:var(--text)}
    .input:focus{border-color:var(--ring);box-shadow:var(--glow)}
    .btn{border:none;border-radius:10px;padding:10px 20px;font-weight:700;font-size:14px;transition:transform .15s ease,box-shadow .2s ease,filter .2s ease;display:inline-flex;align-items:center;gap:6px;justify-content:center;position:relative;overflow:hidden}
    .btn:hover{filter:brightness(1.07);transform:translateY(-2px);box-shadow:0 8px 22px rgba(0,0,0,.18)}
    .btn:active{transform:translateY(0) scale(.98)}
    .btn-red{background:var(--grad-primary);color:#fff}
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
    .fade-in{animation:fadeIn .35s cubic-bezier(.2,.7,.3,1)}
    @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    .slide-in{animation:slideIn .35s cubic-bezier(.2,.7,.3,1)}
    @keyframes slideIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
    .pulse{animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
    .pop-in{animation:popIn .35s cubic-bezier(.34,1.56,.64,1)}
    @keyframes popIn{0%{opacity:0;transform:scale(.85)}100%{opacity:1;transform:scale(1)}}
    .scale-in{animation:scaleIn .3s ease}
    @keyframes scaleIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
    /* Staggered list entrance — set --i inline (index) */
    .stagger>*{animation:fadeIn .4s both cubic-bezier(.2,.7,.3,1);animation-delay:calc(var(--i,0) * 45ms)}
    /* Skeleton shimmer loaders */
    .skeleton{position:relative;overflow:hidden;background:var(--card2);border-radius:10px}
    .skeleton::after{content:"";position:absolute;inset:0;transform:translateX(-100%);
      background:linear-gradient(90deg,transparent,${dm?"rgba(255,255,255,.06)":"rgba(255,255,255,.65)"},transparent);
      animation:shimmer 1.4s infinite}
    @keyframes shimmer{100%{transform:translateX(100%)}}
    .floatY{animation:floatY 3.5s ease-in-out infinite}
    @keyframes floatY{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
    /* Product tile hover */
    .item-tile{transition:transform .25s cubic-bezier(.2,.7,.3,1),box-shadow .25s ease,border-color .25s ease}
    .item-tile:hover{transform:translateY(-4px) scale(1.02);box-shadow:0 12px 30px rgba(0,0,0,.35);border-color:rgba(255,255,255,.28)!important}
    .order-item-card{transition:transform .2s cubic-bezier(.2,.7,.3,1),box-shadow .2s ease}
    .order-item-card:hover{transform:translateY(-3px)}
    .order-item-card:active{transform:scale(.97)}
    /* Soft entrance for badges/counters */
    .bump{animation:bump .3s ease}
    @keyframes bump{0%{transform:scale(1)}40%{transform:scale(1.25)}100%{transform:scale(1)}}
    @media (prefers-reduced-motion: reduce){*{animation-duration:.001ms!important;transition-duration:.001ms!important}}
    .scroll-hide::-webkit-scrollbar{display:none}
    .scroll-hide{-ms-overflow-style:none;scrollbar-width:none}
    @media(max-width:640px){
      .hide-mobile{display:none!important}
      .mobile-full{width:100%!important;grid-column:1/-1!important}
      .order-grid{grid-template-columns:1fr!important;height:auto!important}
      .order-cart{border-radius:var(--radius)!important;max-height:none!important}
    }
    @media(min-width:641px){.show-mobile-only{display:none!important}}

    /* ════════════════════════════════════════════════════════════
       هوية ناردين الدافئة (v8.3) — طبقة موحّدة تُلوّن الموقع كاملاً
       ════════════════════════════════════════════════════════════ */
    :root{
      --accent:#1565c0; --accent2:#c62828;
      --bg:${dm?"#0f1320":"#f5f7fb"};
      --card:${dm?"#161c2b":"#ffffff"};
      --card2:${dm?"#1e2740":"#eef1f7"};
      --border:${dm?"#26304a":"#e6e9f2"};
      --text:${dm?"#e9edf7":"#1f2533"};
      --sub:${dm?"#9aa6c4":"#6b7388"};
      --card-surface:${dm?"#161c2b":"#ffffff"};
      --ring:#1565c0; --glow:0 0 0 3px rgba(21,101,192,.18);
    }
    /* خلفية فاتحة نظيفة هادئة */
    body{
      background:${dm?"#0f1320":"#f5f7fb"} !important;
      color:${dm?"#e9edf7":"#1f2533"} !important;
    }
    /* خطوط أنيقة: عناوين El Messiri، نص Cairo */
    h1,h2,h3,h4{font-family:'El Messiri','Tajawal',sans-serif !important; letter-spacing:.2px; line-height:1.4}
    body,button,input,select,textarea{font-family:'Cairo','Tajawal',sans-serif}
    /* الهيدر: تدرّج أزرق → أحمر أنيق */
    header{
      background:linear-gradient(120deg,#1565c0 0%,#5b3fb0 52%,#c62828 100%) !important;
      box-shadow:0 4px 22px rgba(30,50,110,.28) !important;
    }
    /* الشريط العلوي (للزبون فقط) */
    nav{ background:${dm?"#131829":"#ffffff"} !important; border-bottom:1px solid ${dm?"#222b42":"#eceff5"} !important; }
    /* بطاقات بيضاء راقية بظلال خفيفة */
    .card{
      background:var(--card-surface) !important;
      border:1px solid ${dm?"rgba(255,255,255,.05)":"#eceff5"} !important;
      border-radius:16px !important;
      box-shadow:${dm?"0 6px 22px rgba(0,0,0,.45)":"0 6px 20px rgba(30,45,90,.07)"} !important;
    }
    .card.hoverable:hover{ transform:translateY(-3px) !important; box-shadow:${dm?"0 14px 36px rgba(0,0,0,.55)":"0 14px 34px rgba(30,45,90,.13)"} !important; }
    /* حقول نظيفة + تركيز أزرق */
    .input,input,select,textarea{border-radius:12px}
    .input:focus,input:focus,select:focus,textarea:focus{ border-color:#1565c0 !important; box-shadow:0 0 0 3px rgba(21,101,192,.16) !important; }
    .btn,button{border-radius:12px}
    h1,h2{color:${dm?"#eef2fb":"#1b2436"}; font-weight:700}
    ::selection{background:rgba(21,101,192,.22)}

    /* ════════ الشريط السفلي اللمسي (Bottom Tab Bar) ════════ */
    .bottom-nav{
      position:fixed; left:0; right:0; bottom:0; z-index:300;
      display:flex; align-items:stretch; justify-content:space-around;
      background:${dm?"rgba(19,24,41,.96)":"rgba(255,255,255,.97)"};
      backdrop-filter:saturate(1.4) blur(8px); -webkit-backdrop-filter:saturate(1.4) blur(8px);
      border-top:1px solid ${dm?"#222b42":"#e8ebf3"};
      box-shadow:0 -6px 22px rgba(30,45,90,${dm?".5":".10"});
      padding:6px 6px calc(6px + env(safe-area-inset-bottom)) 6px;
    }
    .bn-cell{
      flex:1; min-height:60px; border:none; background:none; cursor:pointer;
      display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
      border-radius:14px; transition:transform .15s ease, background .2s ease, color .2s ease;
      color:${dm?"#9aa6c4":"#6b7388"}; font-family:'Cairo','Tajawal',sans-serif;
    }
    .bn-cell:active{transform:scale(.92)}
    .bn-cell .bn-ic{font-size:22px; line-height:1}
    .bn-cell .bn-lb{font-size:10px; font-weight:600}
    .bn-cell.active{ color:#fff; background:linear-gradient(135deg,#1565c0,#c62828); box-shadow:0 6px 16px rgba(21,101,192,.30); }
    .bn-cell.active .bn-lb{font-weight:800}
    .bn-sheet-overlay{position:fixed; inset:0; z-index:320; background:rgba(15,19,32,.5); display:flex; align-items:flex-end}
    .bn-sheet{
      width:100%; background:${dm?"#131829":"#ffffff"}; border-radius:22px 22px 0 0;
      padding:14px 14px calc(18px + env(safe-area-inset-bottom)); box-shadow:0 -10px 40px rgba(0,0,0,.3);
      animation:bnUp .28s cubic-bezier(.2,.7,.3,1);
    }
    @keyframes bnUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
    .bn-grid{display:grid; grid-template-columns:repeat(4,1fr); gap:10px}
    .bn-grid button{
      min-height:74px; border:1px solid ${dm?"#222b42":"#eceff5"}; border-radius:16px; cursor:pointer;
      background:${dm?"#1a2236":"#f7f9fd"}; color:${dm?"#e9edf7":"#1f2533"};
      display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px;
      font-family:'Cairo','Tajawal',sans-serif; transition:transform .12s ease;
    }
    .bn-grid button:active{transform:scale(.93)}
    .bn-grid button.active{background:linear-gradient(135deg,#1565c0,#c62828); color:#fff; border-color:transparent}
    .bn-grid .bn-ic{font-size:24px}
    .bn-grid .bn-lb{font-size:11px; font-weight:700}
  `}</style>
  );
}

// ═══════════════════════════════════
// TOAST
// ═══════════════════════════════════
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


export function Toast({toast}){
  if(!toast) return null;
  const bg = toast.type==="error"?"#c62828":toast.type==="warn"?"#e65100":"#2e7d32";
  return(
    <div style={{position:"fixed",top:20,left:"50%",transform:"translateX(-50%)",zIndex:9999,
      background:bg,color:"#fff",padding:"12px 24px",borderRadius:40,fontWeight:700,
      boxShadow:"0 8px 32px rgba(0,0,0,.3)",fontSize:14,whiteSpace:"nowrap",animation:"fadeIn .3s ease"}}>
      {toast.type==="error"?"✗":toast.type==="warn"?"⚠":"✓"} {toast.msg}
    </div>
  );
}

// ═══════════════════════════════════
// PWA INSTALL BANNER
// ═══════════════════════════════════

export function PWABanner(){
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

export function OrderTimer({createdAt,dm,warnAfter=600}){
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
