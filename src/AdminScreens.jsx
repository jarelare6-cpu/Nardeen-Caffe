// شاشات الإدارة — مفصولة من App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore, checkSessionExpiry, touchSession, DEFAULT_SETTINGS } from "./lib/store.js";
import { SUPABASE_READY, sbDeleteAll, sbDelete, sbUpsert, sbFetch, sbFetchDevices } from "./lib/supabase.js";
import OutdoorScreen from "./OutdoorScreen.jsx";
import { playOrderAlert, exportToExcel, generateTableQR, checkStockAlerts, notifyLowStock, sendReceiptWhatsApp, printKitchenTicket, getLoyaltyStatus, calcLoyaltyDiscount, getPartialPaymentStatus, getStaffReport, getPeakHoursData, getSalesComparison, calcShiftSummary, getOrderUrgency, getAvgPrepTime, calcEarnedPoints, getCustomerTier, pointsToValue, SOUND_TONES, calcNetProfit } from "./lib/utils.js";
import { ROLES, ROLE_LABELS, ROLE_COLORS, ORDER_STATUS, STATUS_LABELS, STATUS_COLORS, CAT_LABELS, CAT_ORDER, BAR_CATS, HOOKAH_CATS, STATION_CATS, PERMISSIONS, THEMES, catOf, orderFullyPrepared, canAccess } from "./constants.js";
import { ItemVisual, BottomNav, GlobalStyle, Toast, PWABanner, OrderTimer } from "./uikit.jsx";
import { printOrder, generateReceiptPDF, saveReceiptRecord, saveReceipt } from "./receipts.js";
import { IMAGE_LIBRARY, AUTO_MAP } from "./lib/imageLibrary.js";
import { isNativeApp, lanBase, lanMyIp, lanPing, lanReset } from "./lib/lanSync.js";

// ضغط صورة مرفوعة إلى dataURL صغير (يعمل أوفلاين بلا Storage)
async function compressImage(file, max = 320, quality = 0.72) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
  });
  return await new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
      else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      res(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => res(dataUrl);
    img.src = dataUrl;
  });
}

export function DashboardTab({store,dm,settings}){
  const CUR=settings?.currency||"ل.س";
  // مراقبة الأجهزة المتصلة (heartbeat سحابي)
  const [devices,setDevices]=useState([]);
  const [showAllDev,setShowAllDev]=useState(false);
  useEffect(()=>{
    let active=true;
    const load=async()=>{ try{ const d=await sbFetchDevices(); if(active) setDevices(d||[]); }catch{} };
    load(); const iv=setInterval(load,30000);
    return ()=>{ active=false; clearInterval(iv); };
  },[]);
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
  const todayProfit=calcNetProfit(store.orders,store.menu,today);
  const totalProfit=calcNetProfit(store.orders,store.menu);
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
    <div className="card hoverable" style={{
      background:`linear-gradient(135deg, ${color}26, var(--card) 70%)`,
      border:`1px solid ${color}40`,
      borderTop:`4px solid ${color}`,
      boxShadow:`0 10px 26px ${color}22, var(--shadow)`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
        <div>
          <div style={{color:"var(--sub)",fontSize:12,marginBottom:6,fontWeight:600}}>{label}</div>
          <div style={{fontSize:24,fontWeight:900,color}}>{val}</div>
          {sub&&<div style={{fontSize:11,color:"var(--sub)",marginTop:4}}>{sub}</div>}
        </div>
        <span style={{fontSize:24,width:48,height:48,flexShrink:0,display:"flex",alignItems:"center",
          justifyContent:"center",borderRadius:16,background:`${color}26`,
          boxShadow:`inset 0 0 0 1px ${color}33`}}>{icon}</span>
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
        <Stat icon="📈" label="صافي ربح اليوم"  val={`${todayProfit.toLocaleString()} ${CUR}`} sub="المبيع − التكلفة" color="#00897b"/>
        <Stat icon="💎" label="صافي الربح"      val={`${totalProfit.toLocaleString()} ${CUR}`} sub="كل الوقت" color="#6a1b9a"/>
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

      {/* الأجهزة المتصلة (مراقبة سحابية) */}
      {devices.length>0&&(()=>{
        const now=Date.now();
        const list=[...devices].map(d=>({...d,_on:d.last_seen&&(now-new Date(d.last_seen).getTime())<120000}))
          .sort((a,b)=>(b._on-a._on)||(new Date(b.last_seen||0)-new Date(a.last_seen||0)));
        const onCount=list.filter(d=>d._on).length;
        const ago=(ts)=>{ if(!ts)return"—"; const s=Math.floor((now-new Date(ts).getTime())/1000); if(s<60)return"الآن"; if(s<3600)return`${Math.floor(s/60)} د`; if(s<86400)return`${Math.floor(s/3600)} س`; return`${Math.floor(s/86400)} ي`; };
        return (
          <div className="card" style={{marginBottom:16,borderTop:"3px solid #1565c0"}}>
            <h3 style={{fontSize:14,fontWeight:800,marginBottom:12}}>📡 الأجهزة المتصلة ({onCount}/{list.length})</h3>
            {(showAllDev?list:list.slice(0,5)).map(d=>(
              <div key={d.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid var(--border)",fontSize:13}}>
                <span style={{fontWeight:600}}>
                  <span style={{display:"inline-block",width:9,height:9,borderRadius:"50%",background:d._on?"#2e7d32":"#999",marginInlineEnd:8}}/>
                  {d.label||d.id}
                </span>
                <span style={{color:"var(--sub)",fontSize:12}}>{d._on?"متصل":`آخر ظهور: ${ago(d.last_seen)}`}</span>
              </div>
            ))}
            {list.length>5&&(
              <button onClick={()=>setShowAllDev(v=>!v)}
                style={{width:"100%",marginTop:8,background:"rgba(21,101,192,.1)",color:"#1565c0",border:"none",borderRadius:8,padding:"8px",fontWeight:800,fontSize:13,cursor:"pointer"}}>
                {showAllDev?"أقل ▲":`المزيد (${list.length-5}) ▼`}
              </button>
            )}
            <div style={{fontSize:11,color:"var(--sub)",marginTop:8}}>يُحدَّث كل 30 ثانية. "متصل" = ظهر خلال آخر دقيقتين.</div>
          </div>
        );
      })()}
      {/* قسم الترون اليوم (دفعات فوق الفاتورة) */}
      {(() => {
        const tr = (store.receipts || []).filter(r => r.tronAmount > 0 && new Date(r.createdAt) >= today);
        if (!tr.length) return null;
        const tot = tr.reduce((s, r) => s + r.tronAmount, 0);
        const cnt = tr.length;
        const avg = Math.round(tot / cnt);
        const byEmp = {}; tr.forEach(r => { const k = r.createdBy || "غير محدد"; byEmp[k] = (byEmp[k] || 0) + r.tronAmount; });
        const empList = Object.entries(byEmp).sort((a, b) => b[1] - a[1]);
        return (
          <div className="card" style={{ marginBottom: 16, borderTop: "3px solid #6a1b9a" }}>
            <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>💠 ترون اليوم (دفعات فوق الفاتورة)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}>
              {[["الإجمالي", `${tot.toLocaleString()} ${CUR}`], ["عدد الدفعات", cnt], ["المتوسط", `${avg.toLocaleString()} ${CUR}`]].map(([l, v]) => (
                <div key={l} style={{ background: "var(--card2)", borderRadius: 10, padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--sub)" }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#6a1b9a" }}>{v}</div>
                </div>
              ))}
            </div>
            {empList.map(([name, amt], i) => (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i < empList.length - 1 ? "1px solid var(--border)" : "none", fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>👤 {name}</span>
                <span style={{ fontWeight: 700, color: "#6a1b9a" }}>{amt.toLocaleString()} {CUR}</span>
              </div>
            ))}
          </div>
        );
      })()}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}} className="grid-2">
        <div className="card">
          <h3 style={{fontSize:14,fontWeight:800,marginBottom:12}}>🏆 أكثر المبيعات</h3>
          {topItems.filter(i=>i.totalSold>0).length===0?(
            <div style={{color:"var(--sub)",fontSize:13,textAlign:"center",padding:20}}>لا توجد بيانات بعد</div>
          ):topItems.filter(i=>i.totalSold>0).map((item,i)=>(
            <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",
              borderBottom:i<4?"1px solid var(--border)":"none"}}>
              <ItemVisual item={item} size={28} round={7}/>
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
              <ItemVisual item={item} size={28} round={7}/>
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

export function InventoryTab({store,settings}){
  const CUR=settings?.currency||"ل.س";
  const today=new Date(); today.setHours(0,0,0,0);

  const todayPaid=store.orders.filter(o=>o.status==="paid"&&new Date(o.paidAt||o.createdAt)>=today);
  const todayRevenue=todayPaid.reduce((s,o)=>s+o.total,0);

  // الترون اليوم
  const tronToday=(store.receipts||[]).filter(r=>r.tronAmount>0&&new Date(r.createdAt)>=today).reduce((s,r)=>s+r.tronAmount,0);

  // مصاريف عادية (تدخل الجرد) — الضيافة لا تدخل المصاريف بعد الآن
  const primaryExp=(store.expenses||[]).filter(e=>!e.isSecondary&&!e.isComplimentary&&new Date(e.date)>=today);
  const primaryTotal=primaryExp.reduce((s,e)=>s+e.amount,0);

  // مصاريف ثانوية (لا تدخل الجرد)
  const secondaryExp=(store.expenses||[]).filter(e=>e.isSecondary&&new Date(e.date)>=today);
  const secondaryTotal=secondaryExp.reduce((s,e)=>s+e.amount,0);

  // الجرد = الإجمالي - المصروف اليومي + الترون
  const net=todayRevenue-primaryTotal+tronToday;

  // سجل الضيافة اليوم
  const todayComp=(store.compLog||[]).filter(c=>new Date(c.date)>=today);
  const compTotal=todayComp.reduce((s,c)=>s+c.amount,0);

  const [showSec,setShowSec]=useState(false);
  const [showComp,setShowComp]=useState(false);

  return(
    <div className="fade-in">
      <h2 style={{fontSize:18,fontWeight:900,marginBottom:16}}>📊 الجرد اليومي</h2>

      {/* بطاقات الملخص */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:18}}>
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
        <div className="card" style={{borderTop:"4px solid #6a1b9a",textAlign:"center"}}>
          <div style={{fontSize:22,marginBottom:4}}>💠</div>
          <div style={{fontSize:11,color:"var(--sub)"}}>الترون</div>
          <div style={{fontSize:18,fontWeight:900,color:"#6a1b9a"}}>{tronToday.toLocaleString()} {CUR}</div>
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
          {todayRevenue.toLocaleString()} إيرادات − {primaryTotal.toLocaleString()} مصاريف + {tronToday.toLocaleString()} ترون
        </div>
      </div>

      {/* سجل الضيافة اليوم */}
      <div className="card" style={{borderTop:"4px solid #00897b",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showComp?12:0}}>
          <h3 style={{fontSize:14,fontWeight:800,color:"#00897b"}}>🎁 الضيافة اليوم ({todayComp.length}) — {compTotal.toLocaleString()} {CUR}</h3>
          <button onClick={()=>setShowComp(s=>!s)}
            style={{padding:"4px 12px",borderRadius:8,border:"none",
              background:"var(--card2)",color:"var(--text)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            {showComp?"إخفاء":"عرض"}
          </button>
        </div>
        {showComp&&(
          <>
            {todayComp.length===0?<p style={{color:"var(--sub)",fontSize:13}}>لا توجد ضيافة اليوم</p>:
              todayComp.map(c=>(
                <div key={c.id} style={{padding:"8px 0",borderBottom:"1px solid var(--border)",fontSize:13}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontWeight:700}}>👤 {c.customerName} {c.tableNum?`• طاولة ${c.tableNum}`:""}</span>
                    <span style={{fontWeight:900,color:"#00897b"}}>{c.amount.toLocaleString()} {CUR}</span>
                  </div>
                  <div style={{fontSize:11,color:"var(--sub)"}}>🎁 {c.items.join("، ")} • بواسطة {c.createdBy}</div>
                </div>
              ))
            }
          </>
        )}
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


export function MenuTab({store,showToast,dm,settings}){
  const [showForm,setShowForm]=useState(false);
  const [showLib,setShowLib]=useState(false);
  const [libG,setLibG]=useState(0);
  const [libStyle,setLibStyle]=useState("real");
  const lbl2={fontSize:11,fontWeight:700,color:"var(--sub)",marginBottom:4,display:"block"};
  const imgPrev={width:68,height:68,objectFit:"cover",borderRadius:12,border:"1px solid var(--border)"};
  const rmv={fontSize:10,color:"#c62828",cursor:"pointer",fontWeight:700,marginTop:2};
  const [editItem,setEditItem]=useState(null);
  const [form,setForm]=useState({name:"",nameEn:"",price:"",category:"hot_drinks",stock:"",minStock:"10",cost:"",emoji:"☕",image:"",imageIcon:""});
  const [cat,setCat]=useState("all");

  const filtered=cat==="all"?store.menu:store.menu.filter(m=>m.category===cat);

  const save=()=>{
    if(!form.name||!form.price){showToast("يرجى ملء الحقول الأساسية","error");return}
    if(editItem){
      store.setMenu(p=>p.map(m=>m.id===editItem.id?{...m,...form,price:+form.price,stock:+form.stock,minStock:+form.minStock,cost:+form.cost||0}:m));
      showToast("تم تعديل الصنف");
    } else {
      store.setMenu(p=>[...p,{id:"m"+Date.now(),...form,price:+form.price,stock:+form.stock,minStock:+form.minStock,cost:+form.cost||0,totalSold:0}]);
      showToast("تم إضافة الصنف");
    }
    setShowForm(false);setEditItem(null);setForm({name:"",nameEn:"",price:"",category:"hot_drinks",stock:"",minStock:"10",cost:"",emoji:"☕",image:"",imageIcon:""});
  };

  const openEdit=(item)=>{
    setEditItem(item);
    setForm({name:item.name,nameEn:item.nameEn||"",price:String(item.price),category:item.category,stock:String(item.stock),minStock:String(item.minStock),cost:item.cost!=null?String(item.cost):"",emoji:item.emoji||"☕",image:item.image||"",imageIcon:item.imageIcon||""});
    setShowForm(true);
  };

  const nrm=x=>(x||"").toString().replace(/[\u064B-\u065F\u0670]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/\s+/g,"").toLowerCase();
  const autoLink=()=>{
    let n=0;
    store.setMenu(p=>p.map(it=>{
      const ni=nrm(it.name); if(!ni) return it;
      let best=null,score=0;
      for(const e of AUTO_MAP){ const ne=nrm(e.name);
        let sc = ne===ni?100 : (ni.includes(ne)?ne.length : (ne.includes(ni)?ni.length*0.8:0));
        if(sc>score && sc>=4){score=sc;best=e;} }
      if(best){ n++; return {...it,image:best.real||it.image,imageIcon:best.icon||it.imageIcon}; }
      return it;
    }));
    showToast(n>0?`تم ربط ${n} صنف بالصور — راجعها وعدّل الباقي من المعرض`:"لم يُطابق أي صنف — استخدم المعرض يدويًا", n>0?"success":"error");
  };

  const CUR=settings?.currency||"ل.س";

  return(
    <div className="fade-in">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <h2 style={{fontSize:18,fontWeight:900}}>🍽 إدارة المنيو</h2>
        <div style={{display:"flex",gap:8}}>
          <button onClick={autoLink} title="ربط الصور بالأصناف تلقائيًا حسب الاسم" style={{background:"rgba(21,101,192,.12)",color:"#1565c0",border:"1px solid #1565c033",borderRadius:10,padding:"8px 12px",fontWeight:800,fontSize:13,cursor:"pointer"}}>🔗 ربط تلقائي</button>
          <button className="btn btn-red" onClick={()=>{setEditItem(null);setShowForm(true)}}>+ إضافة صنف</button>
        </div>
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
          <div key={item.id} className="card hoverable" style={{position:"relative"}}>
            <div style={{textAlign:"center",marginBottom:6,minHeight:36,display:"flex",alignItems:"center",justifyContent:"center"}}><ItemVisual item={item} size={36} round={10}/></div>
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
            {[["الاسم بالعربية","name","text"],["الاسم بالإنجليزية","nameEn","text"],["السعر","price","number"],["سعر التكلفة","cost","number"],["المخزون","stock","number"],["الحد الأدنى","minStock","number"],["إيموجي","emoji","text"],["رابط الصورة (اختياري)","image","text"]].map(([label,key,type])=>(
              <div key={key} style={{marginBottom:12}}>
                <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>{label}</label>
                <input className="input" type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/>
              </div>
            ))}
            {/* صور الصنف: مكتبة جاهزة + رفع واقعي/أيقونة */}
            <button type="button" onClick={()=>setShowLib(true)} style={{width:"100%",marginBottom:10,background:"rgba(21,101,192,.12)",color:"#1565c0",border:"1px solid #1565c033",borderRadius:10,padding:"9px",fontWeight:800,fontSize:13,cursor:"pointer"}}>🖼 اختر من مكتبة الصور</button>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:6}}>
              <div>
                <label style={lbl2}>📷 صورة واقعية</label>
                <input className="input" type="file" accept="image/*" style={{padding:6,fontSize:11}}
                  onChange={async e=>{const file=e.target.files&&e.target.files[0]; if(!file)return; try{const url=await compressImage(file); setForm(f=>({...f,image:url})); showToast("تم تحميل الصورة");}catch{showToast("تعذّر","error");} e.target.value="";}}/>
                {(form.image||"").trim() && <div style={{textAlign:"center",marginTop:6}}><img src={form.image} style={imgPrev} onError={e=>{e.currentTarget.style.opacity=.25}}/><div style={rmv} onClick={()=>setForm(f=>({...f,image:""}))}>إزالة</div></div>}
              </div>
              <div>
                <label style={lbl2}>✏ صورة أيقونة</label>
                <input className="input" type="file" accept="image/*" style={{padding:6,fontSize:11}}
                  onChange={async e=>{const file=e.target.files&&e.target.files[0]; if(!file)return; try{const url=await compressImage(file); setForm(f=>({...f,imageIcon:url})); showToast("تم تحميل الأيقونة");}catch{showToast("تعذّر","error");} e.target.value="";}}/>
                {(form.imageIcon||"").trim() && <div style={{textAlign:"center",marginTop:6}}><img src={form.imageIcon} style={imgPrev} onError={e=>{e.currentTarget.style.opacity=.25}}/><div style={rmv} onClick={()=>setForm(f=>({...f,imageIcon:""}))}>إزالة</div></div>}
              </div>
            </div>
            <div style={{fontSize:10,color:"var(--sub)",marginBottom:12}}>الافتراضي يعرض «الواقعي»؛ زر التبديل أعلى الصفحة يحوّل الكل لأيقونات.</div>
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
      {showLib&&(
        <div onClick={()=>setShowLib(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:600,padding:16}}>
          <div onClick={e=>e.stopPropagation()} className="card fade-in" style={{width:"100%",maxWidth:520,maxHeight:"86vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontWeight:900,fontSize:15}}>🖼 مكتبة الصور</div>
              <button onClick={()=>setShowLib(false)} style={{background:"none",border:"none",fontSize:18,color:"var(--sub)",cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"flex",gap:6,marginBottom:8}}>
              {[["real","واقعي"],["icon","أيقونة"]].map(([st,la])=>(
                <button key={st} onClick={()=>setLibStyle(st)} style={{flex:1,padding:"6px",borderRadius:8,border:"none",fontWeight:700,fontSize:12,cursor:"pointer",background:libStyle===st?"#c62828":"var(--card2)",color:libStyle===st?"#fff":"var(--sub)"}}>{la}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:6,overflowX:"auto",marginBottom:10}} className="scroll-hide">
              {IMAGE_LIBRARY.map((g,i)=>(
                <button key={i} onClick={()=>setLibG(i)} style={{padding:"5px 10px",borderRadius:16,border:"none",whiteSpace:"nowrap",fontSize:11,fontWeight:700,cursor:"pointer",background:libG===i?"#1565c0":"var(--card2)",color:libG===i?"#fff":"var(--sub)"}}>{g.label}</button>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(74px,1fr))",gap:8}}>
              {(IMAGE_LIBRARY[libG]?.[libStyle]||[]).map((p,i)=>{
                const sel=(libStyle==="real"?form.image:form.imageIcon)===p;
                return(
                  <div key={i} onClick={()=>{setForm(f=>libStyle==="real"?({...f,image:p}):({...f,imageIcon:p})); showToast(libStyle==="real"?"تم تعيين الصورة الواقعية":"تم تعيين الأيقونة");}}
                    style={{cursor:"pointer",borderRadius:10,padding:4,background:"var(--card2)",border:sel?"2px solid #2e7d32":"1px solid var(--border)"}}>
                    <img src={p} style={{width:"100%",height:62,objectFit:"contain"}} loading="lazy"/>
                  </div>
                );
              })}
              {(IMAGE_LIBRARY[libG]?.[libStyle]||[]).length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",color:"var(--sub)",fontSize:12,padding:16}}>لا توجد صور بهذا النمط لهذه الفئة</div>}
            </div>
            <div style={{fontSize:10,color:"var(--sub)",marginTop:10,textAlign:"center"}}>اختر صورة واقعية وأخرى أيقونة لنفس الصنف.</div>
          </div>
        </div>
      )}
    </div>
  );
}


export function TablesTab({ store, user, showToast, dm, settings }) {
  const [clearModal, setClearModal] = useState(null);
  const CUR = settings?.currency || "ل.س";
  const canManage = user && ["admin", "cashier"].includes(user.role);
  const isAdmin = user?.role === "admin";
  const alertMinutes = settings?.tableAlertMinutes || 60;
  const tableTimerAlert = settings?.tableTimerAlert || false;

  const toggleStatus = (id) => store.setTables(p => p.map(t =>
    t.id === id ? {
      ...t,
      status: t.status === "free" ? "occupied" : "free",
      openedAt: t.status === "free" ? new Date().toISOString() : null,
    } : t
  ));

  // تفريغ طاولة مع إعادة المخزون
  const confirmClear = (t, hardDelete) => {
    setClearModal(null);
    const tableOrders = store.orders.filter(o =>
      String(o.table) === String(t.number) &&
      !["paid", "cancelled", "debt", "complimentary"].includes(o.status)
    );

    if (hardDelete) {
      // إعادة المخزون لكل الأصناف المحذوفة
      if (tableOrders.length > 0) {
        store.setMenu(menu => {
          let updated = [...menu];
          tableOrders.forEach(order => {
            (order.items || []).forEach(item => {
              updated = updated.map(m =>
                m.id === item.itemId ? { ...m, stock: m.stock + (item.qty || 0) } : m
              );
            });
          });
          return updated;
        });
      }
      store.setOrders(p => p.filter(o => String(o.table) !== String(t.number)));
    } else {
      // إلغاء فقط مع إعادة المخزون
      if (tableOrders.length > 0) {
        store.setMenu(menu => {
          let updated = [...menu];
          tableOrders.forEach(order => {
            (order.items || []).forEach(item => {
              updated = updated.map(m =>
                m.id === item.itemId ? { ...m, stock: m.stock + (item.qty || 0) } : m
              );
            });
          });
          return updated;
        });
      }
      store.setOrders(p => p.map(o =>
        String(o.table) === String(t.number) &&
        !["paid", "cancelled", "debt", "complimentary"].includes(o.status)
          ? { ...o, status: "cancelled" } : o
      ));
    }
    store.setTables(p => p.map(tb =>
      tb.id === t.id ? { ...tb, status: "free", openedAt: null } : tb
    ));
    showToast(`🪑 تم تفريغ ${t.label} وإعادة المخزون`);
  };

  const TableTimer = ({ openedAt }) => {
    const [elapsed, setElapsed] = useState(Math.floor((Date.now() - new Date(openedAt)) / 1000));
    useEffect(() => {
      const t = setInterval(() => setElapsed(e => e + 1), 1000);
      return () => clearInterval(t);
    }, []);
    const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60), s = elapsed % 60;
    const overLimit = tableTimerAlert && m + h * 60 >= alertMinutes;
    return (
      <span style={{ fontSize: 11, color: overLimit ? "#c62828" : "#f9a825", fontWeight: 700,
        background: overLimit ? "rgba(198,40,40,.12)" : "transparent", borderRadius: 6, padding: overLimit ? "2px 6px" : "0" }}>
        {overLimit ? "⚠ تجاوز الحد! " : "⏱ "}{h > 0 ? `${h}س ` : ""}{m}د
      </span>
    );
  };

  const activeOrders = (num) => store.orders.filter(o =>
    String(o.table) === String(num) && !["paid", "cancelled", "complimentary"].includes(o.status)
  );
  const free = store.tables.filter(t => t.status === "free").length;
  const occupied = store.tables.filter(t => t.status === "occupied").length;

  return (
    <div className="fade-in">
      {/* Modal تفريغ الطاولة */}
      {clearModal && (
        <div onClick={e => { if (e.target === e.currentTarget) setClearModal(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div className="card fade-in" style={{ width: "100%", maxWidth: 380 }}>
            <div style={{ textAlign: "center", fontSize: 40, marginBottom: 10 }}>🪑</div>
            <h3 style={{ textAlign: "center", fontWeight: 900, marginBottom: 6 }}>تفريغ {clearModal.label}</h3>
            <p style={{ textAlign: "center", fontSize: 13, color: "var(--sub)", marginBottom: 6 }}>
              {activeOrders(clearModal.number).length} طلب نشط — سيتم إعادة المخزون تلقائياً
            </p>
            <div style={{ background: "rgba(46,125,50,.1)", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#2e7d32", fontWeight: 700 }}>
              ♻️ ستُعاد الكميات المحجوزة إلى المخزون
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick={() => confirmClear(clearModal, true)}
                style={{ background: "#c62828", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontWeight: 800, cursor: "pointer" }}>
                🗑 حذف الطلبات + تفريغ + إعادة المخزون
              </button>
              <button onClick={() => confirmClear(clearModal, false)}
                style={{ background: "#e65100", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontWeight: 800, cursor: "pointer" }}>
                🚫 إلغاء الطلبات + تفريغ + إعادة المخزون
              </button>
              <button onClick={() => setClearModal(null)}
                style={{ background: "var(--card2)", border: "none", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer" }}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900 }}>🪑 خريطة الطاولات</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ background: "rgba(46,125,50,.15)", color: "#2e7d32", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 700 }}>
            شاغرة: {free}
          </span>
          <span style={{ background: "rgba(198,40,40,.15)", color: "#c62828", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 700 }}>
            مشغولة: {occupied}
          </span>
          {isAdmin && (
            <button onClick={() => store.addTable && store.addTable()}
              style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 10, padding: "7px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              ＋ طاولة جديدة
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(155px,1fr))", gap: 12 }}>
        {store.tables
          .sort((a, b) => (a.number || 0) - (b.number || 0))
          .map(t => {
            const orders = activeOrders(t.number);
            const total = orders.reduce((s, o) => s + (o.total || 0), 0);
            return (
              <div key={t.id} className="card"
                style={{ borderTop: `4px solid ${t.status === "free" ? "#2e7d32" : "#c62828"}`, cursor: "pointer", transition: "all .2s" }}
                onClick={() => toggleStatus(t.id)}>
                <div style={{ textAlign: "center", fontSize: 26, marginBottom: 6 }}>🪑</div>
                <div style={{ fontWeight: 900, textAlign: "center", fontSize: 14 }}>{t.label}</div>
                <div style={{ textAlign: "center", marginTop: 6 }}>
                  <span style={{
                    background: t.status === "free" ? "rgba(46,125,50,.15)" : "rgba(198,40,40,.15)",
                    color: t.status === "free" ? "#2e7d32" : "#c62828",
                    borderRadius: 20, padding: "3px 12px", fontSize: 12, fontWeight: 700
                  }}>
                    {t.status === "free" ? "شاغرة" : "مشغولة"}
                  </span>
                </div>
                {t.status === "occupied" && t.openedAt && (
                  <div style={{ textAlign: "center", marginTop: 8 }}><TableTimer openedAt={t.openedAt} /></div>
                )}
                {orders.length > 0 && (
                  <div style={{ marginTop: 8, background: "var(--card2)", borderRadius: 8, padding: "6px 8px" }}>
                    {orders.slice(0, 2).map((o, oi) => (
                      <div key={o.id} style={{ marginBottom: oi < 1 ? 6 : 0, paddingBottom: oi < 1 ? 5 : 0, borderBottom: oi < 1 ? "1px dashed var(--border)" : "none" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: "#1565c0" }}>👤 {o.customerName || "زبون"}</span>
                          <span style={{ fontSize: 10, color: "#c62828", fontWeight: 700 }}>{(o.total || 0).toLocaleString()} {CUR}</span>
                        </div>
                        {(o.items || []).slice(0, 2).map((it, ii) => (
                          <div key={ii} style={{ fontSize: 9, color: "var(--sub)", paddingRight: 6 }}>
                            <ItemVisual item={store.menu.find(m=>m.id===it.itemId)||it} size={20} round={6}/> {it.itemName} ×{it.qty}
                          </div>
                        ))}
                      </div>
                    ))}
                    <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 4, display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 900 }}>
                      <span style={{ color: "var(--sub)" }}>{orders.length} طلب</span>
                      <span style={{ color: "#c62828" }}>{total.toLocaleString()} {CUR}</span>
                    </div>
                  </div>
                )}
                {canManage && t.status === "occupied" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={e => { e.stopPropagation();
                        // دفع كامل الطاولة
                        const tOrders = orders.filter(o => o.status === "ready");
                        if (!tOrders.length) { showToast("لا توجد طلبات جاهزة للدفع", "warn"); return; }
                        if (window.confirm(`دفع كامل طاولة ${t.number}؟ (${total.toLocaleString()} ${CUR})`)) {
                          const now = new Date().toISOString();
                          const updated = store.orders.map(o =>
                            tOrders.find(x => x.id === o.id)
                              ? { ...o, status: "paid", paymentType: "cash", paidAt: now }
                              : o
                          );
                          store.setOrders(() => updated);
                          store.setTables(p => p.map(tb => tb.id === t.id ? { ...tb, status: "free", openedAt: null } : tb));
                          showToast(`✓ تم دفع طاولة ${t.number} — ${total.toLocaleString()} ${CUR}`);
                        }
                      }}
                        style={{ flex: 1, background: "rgba(46,125,50,.15)", border: "1.5px solid rgba(46,125,50,.3)", borderRadius: 7, padding: "5px 4px", fontSize: 10, color: "#2e7d32", fontWeight: 700, cursor: "pointer" }}>
                        💵 دفع كامل
                      </button>
                      <button onClick={e => { e.stopPropagation(); setClearModal(t); }}
                        style={{ flex: 1, background: "rgba(198,40,40,.1)", border: "1.5px solid rgba(198,40,40,.25)", borderRadius: 7, padding: "5px 4px", fontSize: 10, color: "#c62828", fontWeight: 700, cursor: "pointer" }}>
                        🗑 تفريغ
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}



// ═══════════════════════════════════
// COMP LOG TAB — سجل الضيافة
// ═══════════════════════════════════

export function CompLogTab({ store, showToast, dm, settings }) {
  const CUR = settings?.currency || "ل.س";
  const [period, setPeriod] = useState("today");
  const [search, setSearch] = useState("");

  const getStart = () => {
    const d = new Date();
    if (period === "today") { d.setHours(0, 0, 0, 0); return d; }
    if (period === "week") { d.setDate(d.getDate() - 7); return d; }
    if (period === "month") { d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
    return new Date(0);
  };

  const logs = (store.compLog || [])
    .filter(c => new Date(c.date) >= getStart())
    .filter(c => !search || c.customerName.includes(search))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const total = logs.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 16 }}>🎁 سجل الضيافة</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[["today","اليوم"],["week","الأسبوع"],["month","الشهر"],["all","الكل"]].map(([v,l]) => (
          <button key={v} onClick={() => setPeriod(v)}
            style={{ padding: "7px 14px", borderRadius: 20, border: "none", cursor: "pointer",
              background: period === v ? "#00897b" : "var(--card2)", color: period === v ? "#fff" : "var(--sub)",
              fontWeight: 700, fontSize: 12 }}>
            {l}
          </button>
        ))}
      </div>
      <input className="input" placeholder="🔍 ابحث باسم الزبون..." value={search}
        onChange={e => setSearch(e.target.value)} style={{ marginBottom: 12 }} />
      <div className="card" style={{ marginBottom: 14, borderTop: "4px solid #00897b", textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "var(--sub)" }}>إجمالي الضيافة</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#00897b" }}>{total.toLocaleString()} {CUR}</div>
        <div style={{ fontSize: 11, color: "var(--sub)" }}>{logs.length} سجل</div>
      </div>
      {!logs.length ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--sub)" }}>
          <div style={{ fontSize: 48 }}>🎁</div>
          <div style={{ marginTop: 10 }}>لا توجد سجلات ضيافة</div>
        </div>
      ) : logs.map(c => (
        <div key={c.id} className="card" style={{ marginBottom: 10, borderRight: "4px solid #00897b" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>👤 {c.customerName}</div>
              <div style={{ fontSize: 11, color: "var(--sub)" }}>
                {c.tableNum ? `طاولة ${c.tableNum} • ` : ""}طلب #{c.orderNum} • {c.createdBy}
              </div>
            </div>
            <span style={{ fontWeight: 900, color: "#00897b", fontSize: 15 }}>{c.amount.toLocaleString()} {CUR}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--sub)" }}>
            🍽 {(c.items || []).join("، ")}
          </div>
          <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 4 }}>
            {new Date(c.date).toLocaleString("ar-SY")}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════
// CUSTOMER FILE TAB — ملف الزبائن (مربوط مع Supabase)
// ═══════════════════════════════════

export function CustomerFileTab({ store, showToast, dm, settings }) {
  const CUR = settings?.currency || "ل.س";
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  // 🔵 تحميل الزبائن من Supabase عند فتح التبويب (يحافظ على كل الحقول)
  useEffect(() => {
    if (!SUPABASE_READY) return;
    setLoading(true);
    sbFetch("customers", "last_visit")
      .then(rows => {
        if (rows && rows.length > 0) {
          store.setCustomers(rows.map(r => ({
            id: r.id, name: r.name,
            visits: r.visits || 1,
            phone: r.phone || "",
            totalOrders: r.total_orders || 0,
            totalSpent: r.total_spent || 0,
            loyaltyPoints: r.loyalty_points || 0,
            loyaltyRedeemed: r.loyalty_redeemed || 0,
            tier: r.tier || "bronze",
            notes: r.notes || "",
            lastVisit: r.last_visit, createdAt: r.created_at,
            orders: r.orders || [],
          })));
        }
      })
      .catch(e => console.error("sbFetch customers:", e))
      .finally(() => setLoading(false));
  }, []);

  const customers = (store.customers || []).filter(c =>
    !search || c.name.includes(search)
  ).sort((a, b) => new Date(b.lastVisit) - new Date(a.lastVisit));

  const custOrders = selected
    ? store.orders.filter(o => (o.customerName === selected.name || (selected.orders||[]).includes(o.id)))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    : [];
  const custTotal = custOrders.filter(o => o.status === "paid").reduce((s, o) => s + o.total, 0);

  if (selected) {
    return (
      <div className="fade-in">
        <button onClick={() => setSelected(null)}
          style={{ background: "var(--card2)", border: "none", borderRadius: 10, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 16 }}>
          ← رجوع
        </button>
        <div className="card" style={{ marginBottom: 16, borderTop: "4px solid #1565c0" }}>
          <div style={{ fontSize: 36, textAlign: "center", marginBottom: 8 }}>👤</div>
          <div style={{ fontWeight: 900, fontSize: 18, textAlign: "center", marginBottom: 4 }}>{selected.name}</div>
          {SUPABASE_READY && (
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, background: "rgba(46,125,50,.15)", color: "#2e7d32",
                borderRadius: 8, padding: "3px 10px", fontWeight: 700 }}>☁ مزامن مع السحابة</span>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12 }}>
            <div style={{ textAlign: "center", background: "var(--card2)", borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 11, color: "var(--sub)" }}>الزيارات</div>
              <div style={{ fontWeight: 900, fontSize: 20, color: "#1565c0" }}>{selected.visits}</div>
            </div>
            <div style={{ textAlign: "center", background: "var(--card2)", borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 11, color: "var(--sub)" }}>إجمالي المبلغ</div>
              <div style={{ fontWeight: 900, fontSize: 14, color: "#2e7d32" }}>{custTotal.toLocaleString()} {CUR}</div>
            </div>
            <div style={{ textAlign: "center", background: "var(--card2)", borderRadius: 10, padding: 10 }}>
              <div style={{ fontSize: 11, color: "var(--sub)" }}>آخر زيارة</div>
              <div style={{ fontWeight: 700, fontSize: 11, color: "var(--sub)" }}>{new Date(selected.lastVisit).toLocaleDateString("ar-SY")}</div>
            </div>
          </div>
          {/* 10. نظام الولاء */}
          {settings?.loyaltyEnabled && (() => {
            const loy = getLoyaltyStatus(selected, settings);
            return (
              <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12,
                background: loy.eligible ? "rgba(46,125,50,.1)" : "rgba(21,101,192,.07)",
                border: `1.5px solid ${loy.eligible ? "#2e7d32" : "#1565c0"}20` }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: loy.eligible ? "#2e7d32" : "#1565c0" }}>
                  ⭐ {loy.eligible ? "مستحق مكافأة!" : "برنامج الولاء"}
                </div>
                {loy.eligible ? (
                  <div style={{ fontSize: 13, color: "#2e7d32", fontWeight: 700 }}>
                    🎉 خصم {loy.discountPercent}% على طلبه القادم!
                  </div>
                ) : (
                  <>
                    <div style={{ height: 6, background: "var(--border)", borderRadius: 4, marginBottom: 6 }}>
                      <div style={{ height: "100%", width: `${(loy.progress/loy.threshold)*100}%`,
                        background: "#1565c0", borderRadius: 4, transition: "width .5s" }}/>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--sub)" }}>
                      {loy.progress}/{loy.threshold} زيارة — يحتاج {loy.nextReward} زيارة أخرى
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          {/* 6. محفظة الولاء — النقاط + الطبقة + الاستبدال */}
          {settings?.loyaltyEnabled && (() => {
            const tier = getCustomerTier(selected.totalSpent || custTotal, settings);
            const points = selected.loyaltyPoints || 0;
            const value = pointsToValue(points, settings);
            const redeem = () => {
              if (points <= 0) { showToast("لا توجد نقاط للاستبدال", "warn"); return; }
              if (!window.confirm(`استبدال ${points} نقطة بقيمة ${value.toLocaleString()} ${CUR}؟`)) return;
              store.setCustomers(p => p.map(c => c.id === selected.id
                ? { ...c, loyaltyPoints: 0, loyaltyRedeemed: (c.loyaltyRedeemed || 0) + points }
                : c));
              store.setLoyaltyLog(p => [{
                id: "loy_" + Date.now(), customerId: selected.id, customerName: selected.name,
                type: "redeem", points: -points, orderId: null, orderNum: "",
                note: `استبدال ${points} نقطة بـ ${value.toLocaleString()} ${CUR}`,
                createdBy: "أدمن", createdAt: new Date().toISOString(),
              }, ...p]);
              setSelected(s => ({ ...s, loyaltyPoints: 0, loyaltyRedeemed: (s.loyaltyRedeemed || 0) + points }));
              showToast(`🎁 تم استبدال ${points} نقطة — امنح الزبون خصم ${value.toLocaleString()} ${CUR}`);
            };
            return (
              <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 12,
                background: "linear-gradient(135deg, rgba(106,27,154,.08), rgba(21,101,192,.08))",
                border: "1.5px solid rgba(106,27,154,.2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontWeight: 800, fontSize: 14 }}>💳 محفظة الولاء</span>
                  <span style={{ fontSize: 12, fontWeight: 800, borderRadius: 20, padding: "3px 12px",
                    background: `${tier.color}20`, color: tier.color }}>{tier.label}</span>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ flex: 1, textAlign: "center", background: "var(--card2)", borderRadius: 10, padding: "10px 8px" }}>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>النقاط الحالية</div>
                    <div style={{ fontWeight: 900, fontSize: 22, color: "#6a1b9a" }}>{points.toLocaleString()}</div>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", background: "var(--card2)", borderRadius: 10, padding: "10px 8px" }}>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>قيمتها</div>
                    <div style={{ fontWeight: 900, fontSize: 16, color: "#2e7d32" }}>{value.toLocaleString()} {CUR}</div>
                  </div>
                </div>
                <button onClick={redeem} disabled={points <= 0}
                  style={{ width: "100%", marginTop: 10, background: points > 0 ? "#6a1b9a" : "var(--card2)",
                    color: points > 0 ? "#fff" : "var(--sub)", border: "none", borderRadius: 10, padding: 11,
                    fontWeight: 800, fontSize: 13, cursor: points > 0 ? "pointer" : "not-allowed" }}>
                  🎁 استبدال النقاط بخصم
                </button>
                <div style={{ fontSize: 10, color: "var(--sub)", textAlign: "center", marginTop: 6 }}>
                  معدل الكسب {((settings?.loyaltyEarnRate ?? 0.05) * 100).toFixed(0)}% × مضاعف الطبقة {tier.mult}×
                </div>
              </div>
            );
          })()}
        </div>
        <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>📋 فواتيره ({custOrders.length})</h3>
        {custOrders.map(o => (
          <div key={o.id} className="card" style={{ marginBottom: 10, borderRight: `4px solid ${o.status === "paid" ? "#2e7d32" : "#ff9800"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontWeight: 900 }}>#{o.orderNum}</span>
              <span style={{ fontSize: 12, color: "var(--sub)" }}>{new Date(o.createdAt).toLocaleDateString("ar-SY")}</span>
            </div>
            {(o.items || []).map((it, i) => (
              <div key={i} style={{ fontSize: 12, color: "var(--sub)", display: "flex", justifyContent: "space-between" }}>
                <span style={{display:"inline-flex",alignItems:"center",gap:6}}><ItemVisual item={store.menu.find(m=>m.id===it.itemId)||it} size={22} round={6}/>{it.itemName} ×{it.qty}</span>
                <span>{(it.price * it.qty).toLocaleString()} {CUR}</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between", fontWeight: 900 }}>
              <span style={{ fontSize: 13 }}>الإجمالي</span>
              <span style={{ color: "#c62828" }}>{(o.total || 0).toLocaleString()} {CUR}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900 }}>👥 ملف الزبائن</h2>
        {SUPABASE_READY && (
          <span style={{ fontSize: 11, background: loading ? "rgba(249,168,37,.15)" : "rgba(46,125,50,.15)",
            color: loading ? "#f9a825" : "#2e7d32", borderRadius: 8, padding: "4px 10px", fontWeight: 700 }}>
            {loading ? "🔄 جارٍ التحميل..." : `☁ متصل • ${customers.length} زبون`}
          </span>
        )}
      </div>
      <input className="input" placeholder="🔍 ابحث عن زبون..." value={search}
        onChange={e => setSearch(e.target.value)} style={{ marginBottom: 14 }} />
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--sub)" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
          <div>جارٍ تحميل بيانات الزبائن...</div>
        </div>
      ) : !customers.length ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--sub)" }}>
          <div style={{ fontSize: 48 }}>👥</div>
          <div style={{ marginTop: 10 }}>لا يوجد زبائن مسجلون بعد</div>
        </div>
      ) : customers.map(c => (
        <div key={c.id} className="card" style={{ marginBottom: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}
          onClick={() => setSelected(c)}>
          <div style={{ fontSize: 32 }}>👤</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{c.name}</div>
            <div style={{ fontSize: 11, color: "var(--sub)" }}>
              {c.visits} زيارة • آخر زيارة: {new Date(c.lastVisit).toLocaleDateString("ar-SY")}
            </div>
          </div>
          <div style={{ fontSize: 13, color: "#1565c0", fontWeight: 700 }}>←</div>
        </div>
      ))}
    </div>
  );
}


export function ReceiptsTab({ store, showToast, dm, settings }) {
  const CUR = settings?.currency || "ل.س";
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const [period, setPeriod] = useState("today");
  const [search, setSearch] = useState("");

  const getStart = () => {
    const d = new Date();
    if (period === "today") { d.setHours(0, 0, 0, 0); return d; }
    if (period === "week") { d.setDate(d.getDate() - 7); return d; }
    if (period === "month") { d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
    return new Date(0);
  };

  const receipts = (store.receipts || [])
    .filter(r => new Date(r.createdAt) >= getStart())
    .filter(r => !search || (r.orderNum || "").includes(search) || (r.customerName || "").includes(search) || (r.tableNum || "").includes(search))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const totalRevenue = receipts.reduce((s, r) => s + (r.total || 0), 0);
  const tronTotal = receipts.filter(r => r.tronAmount > 0).reduce((s, r) => s + r.tronAmount, 0);

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900 }}>🧾 سجل الفواتير</h2>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 18 }}>
        <div className="card" style={{ borderTop: "4px solid #2e7d32", textAlign: "center" }}>
          <div style={{ fontSize: 22, marginBottom: 4 }}>🧾</div>
          <div style={{ fontSize: 11, color: "var(--sub)" }}>عدد الفواتير</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#2e7d32" }}>{receipts.length}</div>
        </div>
        <div className="card" style={{ borderTop: "4px solid #c62828", textAlign: "center" }}>
          <div style={{ fontSize: 22, marginBottom: 4 }}>💰</div>
          <div style={{ fontSize: 11, color: "var(--sub)" }}>إجمالي الإيرادات</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#c62828" }}>{totalRevenue.toLocaleString()} {CUR}</div>
        </div>
        {tronTotal > 0 && (
          <div className="card" style={{ borderTop: "4px solid #6a1b9a", textAlign: "center" }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>💠</div>
            <div style={{ fontSize: 11, color: "var(--sub)" }}>إجمالي الترون</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#6a1b9a" }}>{tronTotal.toLocaleString()} {CUR}</div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[["today", "اليوم"], ["week", "الأسبوع"], ["month", "الشهر"], ["all", "الكل"]].map(([v, l]) => (
          <button key={v} onClick={() => setPeriod(v)} style={{ padding: "7px 16px", borderRadius: 20, border: "none", background: period === v ? "#c62828" : "var(--card2)", color: period === v ? "#fff" : "var(--sub)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            {l}
          </button>
        ))}
      </div>

      <input className="input" placeholder="🔍 بحث برقم الفاتورة / اسم الزبون / الطاولة..."
        value={search} onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 14 }} />

      {!receipts.length ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--sub)" }}>
          <div style={{ fontSize: 48 }}>🧾</div>
          <div style={{ marginTop: 10 }}>لا توجد فواتير في هذه الفترة</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {receipts.map(r => (
            <div key={r.id} className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 32 }}>🧾</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 900, fontSize: 14 }}>فاتورة #{r.orderNum}</div>
                <div style={{ fontSize: 11, color: "var(--sub)" }}>
                  {r.customerName} {r.tableNum ? `• طاولة ${r.tableNum}` : ""}
                  {" • "}{new Date(r.createdAt).toLocaleString("ar-SY")}
                </div>
                <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>
                  {r.paymentType === "cash" ? "💵 نقدي" : r.paymentType === "card" ? "💳 بطاقة" : r.paymentType === "tron" ? "💠 ترون" : r.paymentType}
                  {r.tronAmount > 0 ? ` • ترون: ${r.tronAmount.toLocaleString()} ${CUR}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontWeight: 900, color: "#c62828", fontSize: 15 }}>{(r.total || 0).toLocaleString()} {CUR}</div>
                <button onClick={() => {
                  // إعادة توليد PDF من سجل الفاتورة
                  const fakeOrder = {
                    ...r, id: r.orderId || r.id,
                    orderNum: r.orderNum, customerName: r.customerName,
                    table: r.tableNum, items: r.items || [],
                    total: r.total, discount: r.discount, paymentType: r.paymentType,
                    notes: r.notes,
                  };
                  generateReceiptPDF(fakeOrder, settings, r.tronAmount || 0);
                  showToast("📄 جاري تحميل الفاتورة...");
                }} style={{ marginTop: 6, background: "rgba(25,118,210,.15)", color: "#1565c0", border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  📄 PDF
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}



export function StaffTab({store,showToast,dm}){
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({name:"",username:"",password:"",email:"",role:ROLES.CASHIER,shift:""});
  const [pwModal,setPwModal]=useState(null);
  const [pwInput,setPwInput]=useState("");

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
  const resetPass=(id)=>{ setPwInput(""); setPwModal(id); };
  const savePass=()=>{
    if(!pwInput||pwInput.length<4){showToast("4 أحرف على الأقل","error");return}
    store.setUsers(q=>q.map(u=>u.id===pwModal?{...u,password:pwInput}:u));
    setPwModal(null);setPwInput("");showToast("تم تغيير كلمة المرور");
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

      {pwModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}}>
          <div className="card fade-in" style={{width:"100%",maxWidth:360}}>
            <div style={{fontWeight:900,fontSize:16,marginBottom:6}}>🔑 تغيير كلمة المرور</div>
            <div style={{fontSize:12,color:"var(--sub)",marginBottom:14}}>{store.users.find(u=>u.id===pwModal)?.name||""}</div>
            <input className="input" type="text" autoFocus value={pwInput} onChange={e=>setPwInput(e.target.value)}
              placeholder="كلمة المرور الجديدة (4 أحرف على الأقل)" style={{marginBottom:16}}/>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>{setPwModal(null);setPwInput("")}} style={{flex:1,padding:"10px",border:"1px solid var(--border)",borderRadius:10,background:"var(--card2)",color:"var(--text)",fontWeight:700}}>إلغاء</button>
              <button onClick={savePass} className="btn btn-red" style={{flex:1}}>حفظ</button>
            </div>
          </div>
        </div>
      )}

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

export function ReportsTab({store,dm,settings}){
  const CUR=settings?.currency||"ل.س";
  const [period,setPeriod]=useState("today");

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
  const tronRevenue=(store.receipts||[]).filter(r=>r.tronAmount>0&&new Date(r.createdAt)>=start).reduce((s,r)=>s+r.tronAmount,0);
  const receiptCount=(store.receipts||[]).filter(r=>new Date(r.createdAt)>=start).length;

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
          ["💠","الترون",`${tronRevenue.toLocaleString()} ${CUR}`,"#1565c0"],
          ["🧾","الفواتير",receiptCount,"#00897b"],
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
        <div className="card" style={{marginBottom:16}}>
          <h3 style={{fontSize:14,fontWeight:800,marginBottom:14}}>🏆 أكثر المبيعات</h3>
          {topItems.map((item,i)=>(
            <div key={item.name} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",
              borderBottom:i<topItems.length-1?"1px solid var(--border)":"none"}}>
              <span style={{fontSize:10,fontWeight:800,color:"var(--sub)",minWidth:18}}>#{i+1}</span>
              <ItemVisual item={item} size={32} round={8}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600}}>{item.name}</div>
                <div style={{fontSize:11,color:"var(--sub)"}}>{item.qty} وحدة مباعة</div>
              </div>
              <span style={{fontWeight:700,color:"#c62828",fontSize:12}}>{item.revenue.toLocaleString()} {CUR}</span>
            </div>
          ))}
        </div>
      )}

      {/* قسم الترون التفصيلي (دفعات فوق الفاتورة) */}
      {(() => {
        const tronReceipts = (store.receipts || []).filter(r => r.tronAmount > 0 && new Date(r.createdAt) >= start);
        if (!tronReceipts.length) return null;
        const tTotal = tronReceipts.reduce((s, r) => s + r.tronAmount, 0);
        const tCount = tronReceipts.length;
        const tAvg = Math.round(tTotal / tCount);
        const byEmp = {}; tronReceipts.forEach(r => { const k = r.createdBy || "غير محدد"; byEmp[k] = (byEmp[k] || 0) + r.tronAmount; });
        const byBranch = {}; tronReceipts.forEach(r => { const k = r.branch === "outdoor" ? "خارجي" : "رئيسي"; byBranch[k] = (byBranch[k] || 0) + r.tronAmount; });
        const empList = Object.entries(byEmp).sort((a, b) => b[1] - a[1]);
        const exportTron = () => {
          const rows = [["رقم الطلب", "التاريخ", "الموظف", "الفرع", "الترون"]];
          tronReceipts.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .forEach(r => rows.push([r.orderNum || "", new Date(r.createdAt).toLocaleString("ar-SY"), r.createdBy || "", r.branch === "outdoor" ? "خارجي" : "رئيسي", r.tronAmount]));
          const csv = "\uFEFF" + rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
          const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob); const a = document.createElement("a");
          a.href = url; a.download = `tron-${period}.csv`; a.click(); URL.revokeObjectURL(url);
        };
        return (
          <div className="card" style={{ marginBottom: 16, borderTop: "3px solid #6a1b9a" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ fontSize: 14, fontWeight: 800 }}>💠 الترون (دفعات فوق الفاتورة)</h3>
              <button className="btn btn-ghost" onClick={exportTron} style={{ fontSize: 11, padding: "6px 10px" }}>📄 CSV</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
              {[["الإجمالي", `${tTotal.toLocaleString()} ${CUR}`], ["عدد الدفعات", tCount], ["المتوسط", `${tAvg.toLocaleString()} ${CUR}`]].map(([l, v]) => (
                <div key={l} style={{ background: "var(--card2)", borderRadius: 10, padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--sub)" }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#6a1b9a" }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--sub)" }}>حسب الموظف</div>
            {empList.map(([name, amt], i) => (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: i < empList.length - 1 ? "1px solid var(--border)" : "none", fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>👤 {name}</span>
                <span style={{ fontWeight: 700, color: "#6a1b9a" }}>{amt.toLocaleString()} {CUR}</span>
              </div>
            ))}
            <div style={{ fontSize: 12, fontWeight: 700, margin: "12px 0 6px", color: "var(--sub)" }}>حسب الفرع</div>
            {Object.entries(byBranch).map(([b, amt]) => (
              <div key={b} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>🏠 {b}</span>
                <span style={{ fontWeight: 700, color: "#6a1b9a" }}>{amt.toLocaleString()} {CUR}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* 7. مقارنة المبيعات */}
      {period !== "all" && (() => {
        const now = new Date();
        const comp = getSalesComparison(store.orders, start, now);
        return (
          <div className="card" style={{marginBottom:16}}>
            <h3 style={{fontSize:14,fontWeight:800,marginBottom:14}}>📊 مقارنة بالفترة السابقة</h3>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div style={{background:"var(--card2)",borderRadius:10,padding:12,textAlign:"center"}}>
                <div style={{fontSize:11,color:"var(--sub)",marginBottom:4}}>الفترة الحالية</div>
                <div style={{fontSize:18,fontWeight:900,color:"#c62828"}}>{comp.current.revenue.toLocaleString()} {CUR}</div>
                <div style={{fontSize:12,color:"var(--sub)"}}>{comp.current.orders} طلب</div>
              </div>
              <div style={{background:"var(--card2)",borderRadius:10,padding:12,textAlign:"center"}}>
                <div style={{fontSize:11,color:"var(--sub)",marginBottom:4}}>الفترة السابقة</div>
                <div style={{fontSize:18,fontWeight:900}}>{comp.previous.revenue.toLocaleString()} {CUR}</div>
                <div style={{fontSize:12,color:"var(--sub)"}}>{comp.previous.orders} طلب</div>
              </div>
            </div>
            <div style={{marginTop:12,textAlign:"center",padding:"10px 0",borderRadius:10,
              background:comp.isUp?"rgba(46,125,50,.1)":"rgba(198,40,40,.1)"}}>
              <span style={{fontWeight:900,fontSize:16,color:comp.isUp?"#2e7d32":"#c62828"}}>
                {comp.isUp?"▲":"▼"} {Math.abs(comp.change)}% {comp.isUp?"زيادة":"انخفاض"}
              </span>
            </div>
          </div>
        );
      })()}

      {/* 9. تقرير الموظف الأفضل */}
      {(() => {
        const staffRpt = getStaffReport(store.orders, store.users);
        if (!staffRpt.length) return null;
        return (
          <div className="card" style={{marginBottom:16}}>
            <h3 style={{fontSize:14,fontWeight:800,marginBottom:14}}>👨‍💼 أفضل الموظفين</h3>
            {staffRpt.slice(0,5).map((s,i)=>(
              <div key={s.name} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",
                borderBottom:i<Math.min(staffRpt.length,5)-1?"1px solid var(--border)":"none"}}>
                <span style={{fontSize:18}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":"👤"}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700}}>{s.name}</div>
                  <div style={{fontSize:11,color:"var(--sub)"}}>{s.orders} طلب</div>
                </div>
                <span style={{fontWeight:700,color:"#c62828",fontSize:13}}>{s.revenue.toLocaleString()} {CUR}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* 8. خريطة ساعات الذروة */}
      {(() => {
        const peakData = getPeakHoursData(store.orders.filter(o=>o.status==="paid"));
        const maxCount = Math.max(...peakData.map(h=>h.count), 1);
        const workHours = peakData.filter(h=>h.count>0);
        if (!workHours.length) return null;
        return (
          <div className="card" style={{marginBottom:16}}>
            <h3 style={{fontSize:14,fontWeight:800,marginBottom:14}}>⏰ ساعات الذروة</h3>
            <div style={{display:"flex",alignItems:"flex-end",gap:4,height:80}}>
              {peakData.map(h=>(
                <div key={h.hour} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <div style={{width:"100%",background:h.count===maxCount?"#c62828":"rgba(198,40,40,.25)",borderRadius:"3px 3px 0 0",
                    height:`${Math.max(4,(h.count/maxCount)*70)}px`,transition:"height .3s"}}/>
                  {h.hour%4===0&&<div style={{fontSize:8,color:"var(--sub)"}}>{h.hour}:00</div>}
                </div>
              ))}
            </div>
            <div style={{marginTop:8,fontSize:12,color:"var(--sub)",textAlign:"center"}}>
              ذروة: الساعة {peakData.reduce((a,b)=>b.count>a.count?b:a).hour}:00
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════
// SETTINGS TAB (Admin) — محدّث
// ═══════════════════════════════════

// غلاف قسم الإعدادات — معرّف على مستوى الوحدة (هوية ثابتة) لتفادي فقدان التركيز
function S({label,children}){
  return (
    <div style={{marginBottom:18}}>
      <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:7,display:"block"}}>{label}</label>
      {children}
    </div>
  );
}

function LanCard({store,showToast}){
  const lan=store.settings?.lan||{enabled:false,role:"client",ip:""};
  const native=isNativeApp();
  const [myIp,setMyIp]=useState("");
  const [status,setStatus]=useState("…");
  const update=(patch)=>store.setSettings({...store.settings,lan:{...lan,...patch}});
  useEffect(()=>{
    if(!native||!lan.enabled){setStatus("متوقّف");return;}
    const base=lanBase(lan); if(!base){setStatus("أدخل عنوان الكاشير");return;}
    let stop=false;
    const check=async()=>{
      const p=await lanPing(base); if(stop)return;
      setStatus(p?"متصل ✓":"غير متصل ✗");
      if(lan.role==="cashier"){ const ip=await lanMyIp(base); if(!stop&&ip)setMyIp(ip); }
    };
    check(); const iv=setInterval(check,3000);
    return ()=>{stop=true;clearInterval(iv);};
  },[native,lan.enabled,lan.role,lan.ip]);
  const btn=(active)=>({flex:1,padding:"9px",borderRadius:9,fontWeight:800,fontSize:13,border:"1px solid "+(active?"#c62828":"var(--border)"),background:active?"#c62828":"var(--card2)",color:active?"#fff":"var(--text)",cursor:"pointer"});
  return(
    <div className="card">
      <h3 style={{fontSize:15,fontWeight:800,marginBottom:14,color:"#c62828"}}>📡 المزامنة المحلية (بلا إنترنت)</h3>
      {!native&&<div style={{fontSize:12,color:"var(--sub)",marginBottom:12,lineHeight:1.7}}>تعمل فقط داخل تطبيق أندرويد المثبّت (APK)، وليس من المتصفّح.</div>}
      <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,fontWeight:700}}>
        تفعيل المزامنة المحلية
        <input type="checkbox" checked={!!lan.enabled} onChange={e=>update({enabled:e.target.checked})} style={{width:20,height:20}}/>
      </label>
      <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>دور هذا الجهاز</div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <button style={btn(lan.role==="cashier")} onClick={()=>update({role:"cashier"})}>الكاشير (المركز)</button>
        <button style={btn(lan.role!=="cashier")} onClick={()=>update({role:"client"})}>جهاز عادي</button>
      </div>
      {lan.role==="cashier"?(
        <div style={{background:"var(--card2)",borderRadius:9,padding:12,marginBottom:12}}>
          <div style={{fontSize:12,color:"var(--sub)"}}>عنوان هذا الجهاز (أدخله في باقي الأجهزة):</div>
          <div style={{fontSize:20,fontWeight:900,direction:"ltr",textAlign:"center"}}>{myIp||"…"}</div>
        </div>
      ):(
        <input className="input" placeholder="عنوان الكاشير مثل 192.168.1.50" value={lan.ip||""}
          onChange={e=>update({ip:e.target.value.trim()})} style={{marginBottom:12,direction:"ltr",textAlign:"center"}}/>
      )}
      <div style={{fontSize:13,marginBottom:12}}>الحالة: <b>{status}</b></div>
      {lan.role==="cashier"&&(
        <button onClick={async()=>{const b=lanBase(lan);if(b){await lanReset(b);showToast?.("تم تصفير ترقيم الطلبات ✓");}}}
          style={{width:"100%",padding:"9px",borderRadius:9,border:"1px solid #c62828",background:"transparent",color:"#c62828",fontWeight:800,cursor:"pointer"}}>
          تصفير ترقيم الطلبات
        </button>
      )}
    </div>
  );
}

export function SettingsTab({store,showToast,dm,user}){
  const isAdmin=user?.role==="admin";
  const [_formRaw,_setFormRaw]=useState({...store.settings});
  const _dirty=useRef(false);
  // wrapper: أي تغيير من المستخدم يضع _dirty=true
  const setForm=(v)=>{ _dirty.current=true; _setFormRaw(v); };
  const form=_formRaw;
  // نتابع store.settings: نُحدِّث form فقط إذا لم يكن المستخدم يعدّل
  useEffect(()=>{
    if(!_dirty.current){ _setFormRaw(s=>({...s,...store.settings})); }
  },[store.settings]);
  // نغمة هذا الجهاز (محلية — لتمييزه)
  const [devSound,setDevSound]=useState(()=>{
    try{ const le=localStorage.getItem("nc_sound_enabled");
      return { enabled: le!==null?le==="1":!!store.settings?.soundEnabled, tone: localStorage.getItem("nc_sound_tone")||store.settings?.soundTone||"bell" };
    }catch{ return { enabled:false, tone:"bell" }; }
  });
  const setDevSoundEnabled=(v)=>{ try{localStorage.setItem("nc_sound_enabled",v?"1":"0");}catch{} setDevSound(s=>({...s,enabled:v})); };
  const setDevTone=(t)=>{ try{localStorage.setItem("nc_sound_tone",t);}catch{} setDevSound(s=>({...s,tone:t})); try{playOrderAlert(t);}catch{} };
  const onCustomTone=(file)=>{
    if(!file) return;
    if(file.size>1024*1024){ showToast?.("الملف كبير — اختر نغمة أقصر (~1MB)","warn"); return; }
    const r=new FileReader();
    r.onload=()=>{ try{ localStorage.setItem("nc_sound_custom",r.result); setDevTone("custom"); showToast?.("تم حفظ نغمتك المخصّصة ✓"); }catch{ showToast?.("تعذّر الحفظ — الحجم كبير","warn"); } };
    r.readAsDataURL(file);
  };
  const [permTab,setPermTab]=useState(false);
  // صلاحيات الأقسام القابلة للتعديل
  const [dynPerms,setDynPerms]=useState(()=>{
    const base={};
    Object.entries(PERMISSIONS).forEach(([k,roles])=>{ base[k]=[...roles]; });
    // دمج أي overrides محفوظة
    const saved=store.permOverrides||{};
    Object.entries(saved).forEach(([k,roles])=>{ base[k]=roles; });
    return base;
  });

  const save=()=>{
    _dirty.current=false; // بعد الحفظ نسمح لـ store.settings بالتحديث
    store.setSettings(form);
    store.setPermOverrides(dynPerms);
    showToast("تم حفظ الإعدادات ✓");
  };

  const togglePerm=(section,role)=>{
    setDynPerms(p=>{
      const cur=p[section]||[];
      const next=cur.includes(role)?cur.filter(r=>r!==role):[...cur,role];
      return {...p,[section]:next};
    });
  };

  const sectionLabels={
    dashboard:"لوحة التحكم",order:"طلب جديد",orders:"الطلبات",
    cashier:"الكاشير",customers:"الزبائن",complog:"الضيافة",
    debts:"الديون",expenses:"المصاريف",bar:"البار",
    hookah:"الأراكيل",menu:"المنيو",tables:"الطاولات",
    staff:"الموظفون",reports:"التقارير",receipts:"الفواتير",
    settings:"الإعدادات",
  };

  return(
    <div className="fade-in">
      <h2 style={{fontSize:18,fontWeight:900,marginBottom:20}}>⚙ الإعدادات</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:20}}>

        <LanCard store={store} showToast={showToast}/>

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
              {[["default","🔴 أحمر"],["green","🟢 أخضر"],["purple","🟣 بنفسجي"],["blue","🔵 أزرق"],["gold","🟡 ذهبي"],["teal","🩵 تيل"],["dark","🖤 داكن بالكامل"]].map(([v,l])=>(
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
          </S>
          <S label="🔔 نغمة هذا الجهاز (محلية — لتمييزه)">
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <input type="checkbox" checked={devSound.enabled} onChange={e=>setDevSoundEnabled(e.target.checked)} id="devsnd"/>
              <label htmlFor="devsnd" style={{fontSize:13,fontWeight:600}}>تفعيل صوت التنبيه على هذا الجهاز</label>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {SOUND_TONES.map(t=>(
                <button key={t.id} onClick={()=>setDevTone(t.id)}
                  style={{padding:"8px 12px",borderRadius:10,border:"none",fontWeight:700,fontSize:12,cursor:"pointer",
                    background:devSound.tone===t.id?"var(--red)":"var(--card2)",color:devSound.tone===t.id?"#fff":"var(--sub)"}}>
                  {t.label}
                </button>
              ))}
              <label htmlFor="customtone"
                style={{padding:"8px 12px",borderRadius:10,fontWeight:700,fontSize:12,cursor:"pointer",
                  background:devSound.tone==="custom"?"var(--red)":"var(--card2)",color:devSound.tone==="custom"?"#fff":"var(--sub)"}}>
                🎵 من جهازي
              </label>
              <input id="customtone" type="file" accept="audio/*" style={{display:"none"}}
                onChange={e=>onCustomTone(e.target.files&&e.target.files[0])}/>
            </div>
            <div style={{fontSize:11,color:"var(--sub)",marginTop:8,lineHeight:1.7}}>
              تُحفظ محليًا على هذا الجهاز فقط — كل جهاز يختار نغمة مختلفة فتميّزون مصدر التنبيه. اضغط أي نغمة لتجربتها، أو "🎵 من جهازي" لاختيار نغمة من ملفاتك (حتى ~1MB).
            </div>
          </S>
          {/* 10. نظام الولاء */}
          <S label="⭐ نظام الولاء">
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <input type="checkbox" checked={form.loyaltyEnabled||false}
                onChange={e=>setForm(f=>({...f,loyaltyEnabled:e.target.checked}))} id="loyalty"/>
              <label htmlFor="loyalty" style={{fontSize:13,fontWeight:600}}>تفعيل نظام الولاء</label>
            </div>
            {form.loyaltyEnabled&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div>
                  <label style={{fontSize:11,color:"var(--sub)",display:"block",marginBottom:4}}>عدد الزيارات للمكافأة</label>
                  <input className="input" type="number" min="1" max="100" value={form.loyaltyVisitsForReward??10}
                    onChange={e=>setForm(f=>({...f,loyaltyVisitsForReward:+e.target.value}))}/>
                </div>
                <div>
                  <label style={{fontSize:11,color:"var(--sub)",display:"block",marginBottom:4}}>نسبة الخصم عند المكافأة %</label>
                  <input className="input" type="number" min="1" max="100" value={form.loyaltyDiscountPercent??10}
                    onChange={e=>setForm(f=>({...f,loyaltyDiscountPercent:+e.target.value}))}/>
                </div>
                <div>
                  <label style={{fontSize:11,color:"var(--sub)",display:"block",marginBottom:4}}>معدل كسب النقاط %</label>
                  <input className="input" type="number" min="0" max="100" step="1"
                    value={Math.round((form.loyaltyEarnRate ?? 0.05)*100)}
                    onChange={e=>setForm(f=>({...f,loyaltyEarnRate:(+e.target.value)/100}))}/>
                </div>
                <div>
                  <label style={{fontSize:11,color:"var(--sub)",display:"block",marginBottom:4}}>قيمة النقطة ({form.currency||"ل.س"})</label>
                  <input className="input" type="number" min="0" step="0.1" value={form.loyaltyPointValue ?? 1}
                    onChange={e=>setForm(f=>({...f,loyaltyPointValue:+e.target.value}))}/>
                </div>
              </div>
            )}
          </S>
          {/* 11. المزامنة المباشرة P2P (تجريبي) */}
          <S label="🔗 المزامنة المباشرة بين الأجهزة (تجريبي)">
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
              <input type="checkbox" checked={form.meshEnabled||false}
                onChange={e=>setForm(f=>({...f,meshEnabled:e.target.checked}))} id="mesh"/>
              <label htmlFor="mesh" style={{fontSize:13,fontWeight:600}}>تفعيل التزامن المباشر عبر الشبكة المحلية</label>
            </div>
            <div style={{fontSize:11,color:"var(--sub)",lineHeight:1.7}}>
              تجريبي: يزامن الطلبات مباشرةً بين الأجهزة على نفس الراوتر (P2P)، ويستمر أثناء انقطاع الإنترنت
              للأجهزة المتصلة مسبقًا. فعّله على كل الأجهزة واختبره. عطّل "AP/Client Isolation" في الراوتر.
              عند الإطفاء يعمل التطبيق عبر السحابة كالمعتاد.
            </div>
          </S>
          <S label="لغة الواجهة">
            <div style={{display:"flex",gap:10}}>
              {[["ar","🇸🇦 عربي"],["en","🇬🇧 English"]].map(([v,l])=>(
                <button key={v} onClick={()=>setForm(f=>({...f,appLang:v}))}
                  style={{flex:1,padding:"10px 0",borderRadius:12,border:"none",
                    fontWeight:700,fontSize:14,cursor:"pointer",
                    background:(form.appLang||"ar")===v?"#c62828":"var(--card2)",
                    color:(form.appLang||"ar")===v?"#fff":"var(--sub)",transition:"all .2s"}}>
                  {l}
                </button>
              ))}
            </div>
          </S>
        </div>

        {/* Sound & Notifications */}
        <div className="card">
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:16,color:"#00897b"}}>🔔 الإشعارات والصوت</h3>
          {[
            ["soundEnabled","🔊 تفعيل الصوت عند ورود طلب جديد"],
            ["soundOnReady","🎵 صوت عند تجهيز الطلب"],
            ["soundOnDebt","🔔 صوت عند تسجيل دين"],
            ["notifyBrowser","🖥 إشعارات المتصفح للطلبات الجديدة"],
          ].map(([key,label])=>(
            <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              marginBottom:12,padding:"10px 14px",background:"var(--card2)",borderRadius:10}}>
              <span style={{fontSize:13,fontWeight:600}}>{label}</span>
              <button onClick={()=>setForm(f=>({...f,[key]:!f[key]}))}
                style={{width:48,height:26,borderRadius:13,border:"none",position:"relative",
                  background:form[key]?"#00897b":"var(--border)",transition:"background .3s",cursor:"pointer"}}>
                <div style={{position:"absolute",top:3,left:form[key]?3:23,width:20,height:20,
                  borderRadius:"50%",background:"#fff",transition:"left .3s",boxShadow:"0 2px 4px rgba(0,0,0,.2)"}}/>
              </button>
            </div>
          ))}
          <S label="نغمة الإشعارات">
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {[["bell","🔔 جرس"],["chime","🎵 نغمة"],["ping","📳 بينج"],["beep","📢 بيب"]].map(([v,l])=>(
                <button key={v} onClick={()=>setForm(f=>({...f,soundTone:v}))}
                  style={{padding:"7px 12px",borderRadius:10,border:"none",fontSize:12,fontWeight:700,
                    cursor:"pointer",background:(form.soundTone||"bell")===v?"#00897b":"var(--card2)",
                    color:(form.soundTone||"bell")===v?"#fff":"var(--sub)"}}>
                  {l}
                </button>
              ))}
            </div>
          </S>
        </div>

        {/* Table System */}
        <div className="card">
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:16,color:"#1565c0"}}>🪑 نظام الطاولات</h3>
          {[
            ["openTableSystem","تفعيل نظام الطاولة المفتوحة"],
            ["autoFreeTable","تحرير الطاولة تلقائياً عند الدفع"],
            ["tableTimerAlert","تنبيه عند تجاوز الطاولة مدة محددة"],
            ["mergeTableOrders","دمج طلبات نفس الطاولة تلقائياً"],
          ].map(([key,label])=>(
            <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              marginBottom:12,padding:"10px 14px",background:"var(--card2)",borderRadius:10}}>
              <span style={{fontSize:13,fontWeight:600}}>{label}</span>
              <button onClick={()=>setForm(f=>({...f,[key]:!f[key]}))}
                style={{width:48,height:26,borderRadius:13,border:"none",position:"relative",
                  background:form[key]?"#1565c0":"var(--border)",transition:"background .3s",cursor:"pointer"}}>
                <div style={{position:"absolute",top:3,left:form[key]?3:23,width:20,height:20,
                  borderRadius:"50%",background:"#fff",transition:"left .3s",boxShadow:"0 2px 4px rgba(0,0,0,.2)"}}/>
              </button>
            </div>
          ))}
          {form.tableTimerAlert&&(
            <S label="⏱ وقت التنبيه (بالدقائق)">
              <input className="input" type="number" min="10" max="240" value={form.tableAlertMinutes??60}
                onChange={e=>setForm(f=>({...f,tableAlertMinutes:+e.target.value}))}/>
            </S>
          )}
          <S label="عدد الطاولات الافتراضي">
            <input className="input" type="number" min="1" max="100" value={form.defaultTableCount||20}
              onChange={e=>setForm(f=>({...f,defaultTableCount:+e.target.value}))}/>
          </S>
        </div>

        {/* Order Settings */}
        <div className="card">
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:16,color:"#f9a825"}}>📋 إعدادات الطلبات</h3>
          {[
            ["workerCanDecreaseStock","الموظفون يمكنهم تخفيض المخزون يدوياً"],
            ["cashierCanSeeReports","الكاشير يمكنه مشاهدة التقارير"],
            ["allowCustomerOrders","السماح بطلبات الزبائن (واجهة الزبون)"],
            ["requireTableOnOrder","إلزام رقم الطاولة عند الطلب"],
            ["printOnNewOrder","طباعة تلقائية عند تسجيل طلب جديد"],
          ].map(([key,label])=>(
            <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              marginBottom:12,padding:"10px 14px",background:"var(--card2)",borderRadius:10}}>
              <span style={{fontSize:13,fontWeight:600}}>{label}</span>
              <button onClick={()=>setForm(f=>({...f,[key]:!f[key]}))}
                style={{width:48,height:26,borderRadius:13,border:"none",position:"relative",
                  background:form[key]?"#f9a825":"var(--border)",transition:"background .3s",cursor:"pointer"}}>
                <div style={{position:"absolute",top:3,left:form[key]?3:23,width:20,height:20,
                  borderRadius:"50%",background:"#fff",transition:"left .3s",boxShadow:"0 2px 4px rgba(0,0,0,.2)"}}/>
              </button>
            </div>
          ))}
          <S label="الحد الأقصى للخصم (كاشير/عامل) %">
            <input className="input" type="number" min="0" max="100" value={form.maxDiscount??50}
              onChange={e=>setForm(f=>({...f,maxDiscount:+e.target.value}))}/>
          </S>
        </div>

        {/* Role Permissions — قابلة للتعديل */}
        <div className="card" style={{gridColumn:"1/-1"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:permTab?16:0}}>
            <h3 style={{fontSize:15,fontWeight:800,color:"#6a1b9a"}}>🔐 إدارة صلاحيات الأقسام</h3>
            <button onClick={()=>setPermTab(s=>!s)}
              style={{padding:"8px 16px",borderRadius:10,border:"none",background:permTab?"#6a1b9a":"var(--card2)",
                color:permTab?"#fff":"var(--text)",fontWeight:700,fontSize:12,cursor:"pointer"}}>
              {permTab?"إخفاء ▲":"تعديل الصلاحيات ▼"}
            </button>
          </div>
          {permTab&&(
            <div style={{overflowX:"auto"}}>
              <div style={{fontSize:12,color:"var(--sub)",marginBottom:10}}>
                ✏ انقر على أي صلاحية لتفعيلها أو إلغائها — الأدمن دائماً لديه صلاحية كاملة
              </div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead>
                  <tr style={{background:"var(--card2)"}}>
                    <th style={{padding:"10px 14px",textAlign:"right",fontWeight:700}}>القسم</th>
                    {Object.entries(ROLE_LABELS).filter(([v])=>v!==ROLES.CUSTOMER&&v!==ROLES.ADMIN).map(([r,l])=>(
                      <th key={r} style={{padding:"10px 12px",fontWeight:700,color:ROLE_COLORS[r],whiteSpace:"nowrap"}}>{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(sectionLabels).filter(s=>!["customer_home","myorders"].includes(s)).map(section=>(
                    <tr key={section} style={{borderBottom:"1px solid var(--border)"}}>
                      <td style={{padding:"8px 14px",fontWeight:600}}>{sectionLabels[section]||section}</td>
                      {Object.keys(ROLE_LABELS).filter(r=>r!==ROLES.CUSTOMER&&r!==ROLES.ADMIN).map(role=>{
                        const hasPerm=(dynPerms[section]||[]).includes(role);
                        return(
                          <td key={role} style={{padding:"8px 12px",textAlign:"center"}}>
                            <button onClick={()=>togglePerm(section,role)}
                              style={{background:"none",border:"none",cursor:"pointer",fontSize:18,
                                color:hasPerm?"#2e7d32":"var(--border)",transition:"color .2s"}}>
                              {hasPerm?"✅":"⬜"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Danger Zone */}
        {isAdmin&&(
          <div className="card" style={{gridColumn:"1/-1",borderTop:"4px solid #c62828"}}>
            <h3 style={{fontSize:15,fontWeight:800,marginBottom:14,color:"#c62828"}}>⚠️ منطقة الأدمن — تصفير</h3>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button onClick={async()=>{if(window.confirm("تصفير جميع الطلبات؟ لا يمكن التراجع!")){store.setOrders([]);store.setCashLog([]);if(SUPABASE_READY){await sbDeleteAll("orders");await sbDeleteAll("cash_log");}showToast("تم تصفير المبيعات","warn");}}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#c62828",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير المبيعات
              </button>
              <button onClick={async()=>{if(window.confirm("تصفير الديون؟")){store.setDebts([]);if(SUPABASE_READY){await sbDeleteAll("debts");}showToast("تم","warn");}}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#6a1b9a",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير الديون
              </button>
              <button onClick={async()=>{if(window.confirm("تصفير المصاريف؟")){store.setExpenses([]);if(SUPABASE_READY){await sbDeleteAll("expenses");}showToast("تم","warn");}}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#e65100",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير المصاريف
              </button>
              <button onClick={async()=>{if(window.confirm("تصفير سجل الضيافة؟")){store.setCompLog([]);if(SUPABASE_READY){await sbDeleteAll("comp_log");}showToast("تم","warn");}}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#00897b",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير الضيافة
              </button>
              <button onClick={async()=>{if(window.confirm("تصفير بيانات الزبائن؟")){store.setCustomers([]);if(SUPABASE_READY){await sbDeleteAll("customers");}showToast("تم","warn");}}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#1565c0",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير الزبائن
              </button>
              <button onClick={async()=>{if(window.confirm("تصفير سجل الفواتير؟ لا يمكن التراجع!")){store.setReceipts([]);if(SUPABASE_READY){await sbDeleteAll("receipts");}showToast("تم تصفير الفواتير","warn");}}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#37474f",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير الفواتير
              </button>
              <button onClick={async()=>{
                if(!window.confirm("إعادة تعيين الإعدادات للافتراضية وحذف بيانات السحابة القديمة؟")) return;
                // 1. احذف إعدادات السحابة القديمة
                if(SUPABASE_READY){
                  try{ await sbUpsert("app_settings",{id:"main",data:{},updated_at:new Date().toISOString()},"id"); }catch(e){ console.warn(e); }
                }
                // 2. امسح المحلي
                try{ localStorage.removeItem("nc_settings"); }catch{}
                // 3. احفظ القيم الافتراضية مع طابع زمني جديد
                const fresh={...DEFAULT_SETTINGS,_savedAt:new Date().toISOString()};
                store.setSettings(fresh);
                setForm({...fresh});
                showToast("✅ تم تصفير الإعدادات وحذف البيانات القديمة","warn");
              }} style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#004d40",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🔄 تصفير الإعدادات
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{marginTop:24,display:"flex",justifyContent:"flex-end"}}>
        <button className="btn btn-red" onClick={save} style={{padding:"12px 32px",fontSize:15}}>
          💾 حفظ الإعدادات
        </button>
      </div>
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════
// OUTDOOR ADMIN TAB — لوحة إدارة الحديقة للأدمن
// ═══════════════════════════════════════════════════════════════

export function OutdoorAdminTab({ store, showToast, dm, settings }) {
  const CUR = settings?.currency || "ل.س";
  const [adminTab, setAdminTab] = React.useState("overview"); // overview | orders | receipts | tables | reset

  const outdoorOrders   = (store.orders   || []).filter(o => o.branch === "outdoor");
  const outdoorReceipts = (store.receipts || []).filter(r => r.branch === "outdoor");
  const outdoorCash     = (store.cashLog  || []).filter(e => e.branch === "outdoor");
  const outdoorTables   = store.outdoorTables || [];

  const totalRevenue  = outdoorCash.filter(e => e.type === "sale").reduce((s, e) => s + (e.amount || 0), 0);
  const partnerShare  = Math.round(totalRevenue / 3);
  const cafeShare     = totalRevenue - partnerShare;
  const pendingCount  = outdoorOrders.filter(o => o.status === "pending").length;
  const paidCount     = outdoorOrders.filter(o => o.status === "paid").length;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayRevenue = outdoorCash
    .filter(e => e.type === "sale" && new Date(e.at) >= today)
    .reduce((s, e) => s + (e.amount || 0), 0);

  // ── تصفير الحديقة ──────────────────────────────────────────
  const resetOutdoorOrders = async () => {
    if (!window.confirm("تصفير جميع طلبات الحديقة؟ لا يمكن التراجع!")) return;
    store.setOrders(p => p.filter(o => o.branch !== "outdoor"));
    store.setCashLog(p => p.filter(e => e.branch !== "outdoor"));
    if (SUPABASE_READY) {
      // حذف الطلبات والكاش الخاصة بالحديقة فقط
      const ids = outdoorOrders.map(o => o.id);
      for (const id of ids) { try { await sbDelete("orders", id); } catch {} }
    }
    showToast("تم تصفير مبيعات الحديقة", "warn");
  };

  const resetOutdoorReceipts = async () => {
    if (!window.confirm("تصفير فواتير الحديقة؟")) return;
    store.setReceipts(p => p.filter(r => r.branch !== "outdoor"));
    const ids = outdoorReceipts.map(r => r.id);
    if (SUPABASE_READY) { for (const id of ids) { try { await sbDelete("receipts", id); } catch {} } }
    showToast("تم تصفير فواتير الحديقة", "warn");
  };

  const resetOutdoorCash = async () => {
    if (!window.confirm("تصفير كاش الحديقة؟")) return;
    const cashIds = outdoorCash.map(e => e.id);
    store.setCashLog(p => p.filter(e => e.branch !== "outdoor"));
    if (SUPABASE_READY) { for (const id of cashIds) { try { await sbDelete("cash_log", id); } catch {} } }
    showToast("تم تصفير كاش الحديقة", "warn");
  };

  const resetOutdoorTables = () => {
    if (!window.confirm("تحرير جميع طاولات الحديقة؟")) return;
    store.setOutdoorTables(p => p.map(t => ({ ...t, status: "free", orderId: null, openedAt: null })));
    showToast("تم تحرير جميع طاولات الحديقة", "warn");
  };

  const resetAllOutdoor = async () => {
    if (!window.confirm("⚠️ تصفير كل بيانات الحديقة (طلبات + كاش + فواتير)؟")) return;
    const oIds = outdoorOrders.map(o => o.id);
    const rIds = outdoorReceipts.map(r => r.id);
    const cIds = outdoorCash.map(e => e.id);
    store.setOrders(p => p.filter(o => o.branch !== "outdoor"));
    store.setCashLog(p => p.filter(e => e.branch !== "outdoor"));
    store.setReceipts(p => p.filter(r => r.branch !== "outdoor"));
    store.setOutdoorTables(p => p.map(t => ({ ...t, status: "free", orderId: null, openedAt: null })));
    if (SUPABASE_READY) {
      for (const id of oIds) { try { await sbDelete("orders", id); } catch {} }
      for (const id of rIds) { try { await sbDelete("receipts", id); } catch {} }
      for (const id of cIds) { try { await sbDelete("cash_log", id); } catch {} }
    }
    showToast("تم التصفير الشامل للحديقة", "warn");
  };

  const Card = ({ icon, label, val, sub, color }) => (
    <div className="card" style={{ borderTop: `4px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "var(--sub)", fontSize: 12, marginBottom: 5 }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 900, color }}>{val}</div>
          {sub && <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 3 }}>{sub}</div>}
        </div>
        <span style={{ fontSize: 28 }}>{icon}</span>
      </div>
    </div>
  );

  return (
    <div className="fade-in">
      {/* عنوان */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <span style={{ fontSize: 28 }}>🌿</span>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 900 }}>إدارة الحديقة الخارجية</h2>
          <div style={{ fontSize: 12, color: "var(--sub)" }}>صلاحيات أدمن كاملة</div>
        </div>
      </div>

      {/* تبويبات داخلية */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        {[
          ["overview", "📊", "نظرة عامة"],
          ["orders",   "📋", "الطلبات"],
          ["receipts", "🧾", "الفواتير"],
          ["tables",   "🪑", "الطاولات"],
          ["reset",    "⚠️", "التصفير"],
        ].map(([t, icon, label]) => (
          <button key={t} onClick={() => setAdminTab(t)}
            style={{
              padding: "8px 16px", borderRadius: 10, border: "none", fontFamily: "inherit",
              fontWeight: 700, fontSize: 13, cursor: "pointer", transition: "all .2s",
              background: adminTab === t ? (t === "reset" ? "#c62828" : "#2e7d32") : "var(--card2)",
              color: adminTab === t ? "#fff" : "var(--text)",
            }}>
            {icon} {label}
          </button>
        ))}
      </div>

      {/* ══ نظرة عامة ══ */}
      {adminTab === "overview" && (
        <div className="fade-in">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 20 }}>
            <Card icon="💰" label="إجمالي الحديقة"    val={`${totalRevenue.toLocaleString()} ${CUR}`}  color="#2e7d32" sub="كل الوقت"/>
            <Card icon="📅" label="مبيعات اليوم"      val={`${todayRevenue.toLocaleString()} ${CUR}`}  color="#1565c0" sub="منذ منتصف الليل"/>
            <Card icon="🤝" label="حصة الشريك (⅓)"   val={`${partnerShare.toLocaleString()} ${CUR}`}  color="#6a1b9a"/>
            <Card icon="☕" label="حصة الكافيه (⅔)"   val={`${cafeShare.toLocaleString()} ${CUR}`}     color="#c62828"/>
            <Card icon="⏳" label="طلبات معلقة"       val={pendingCount}                               color="#f9a825"/>
            <Card icon="✅" label="طلبات مدفوعة"      val={paidCount}                                  color="#2e7d32"/>
            <Card icon="🪑" label="طاولات مشغولة"    val={outdoorTables.filter(t=>t.status==="busy").length} color="#e65100" sub={`من ${outdoorTables.length} طاولة`}/>
            <Card icon="🧾" label="عدد الفواتير"      val={outdoorReceipts.length}                     color="#00897b"/>
          </div>

          {/* آخر 5 طلبات */}
          <div className="card">
            <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 12, color: "var(--sub)" }}>آخر الطلبات</h3>
            {outdoorOrders.slice(0, 5).length === 0
              ? <div style={{ color: "var(--sub)", fontSize: 13 }}>لا توجد طلبات</div>
              : outdoorOrders.slice(0, 5).map(o => (
                <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>#{o.orderNum}</span>
                    <span style={{ fontSize: 12, color: "var(--sub)", marginRight: 8 }}>{o.table}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#2e7d32" }}>{o.total.toLocaleString()} {CUR}</span>
                    <span className={`badge s-${o.status}`}>{STATUS_LABELS[o.status] || o.status}</span>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ══ الطلبات ══ */}
      {adminTab === "orders" && (
        <div className="fade-in">
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>📋 جميع طلبات الحديقة ({outdoorOrders.length})</h3>
            {outdoorOrders.length === 0
              ? <div style={{ color: "var(--sub)", textAlign: "center", padding: 24 }}>لا توجد طلبات</div>
              : outdoorOrders.map(o => (
                <div key={o.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontWeight: 800, color: "var(--red)" }}>#{o.orderNum}</span>
                      <span style={{ fontSize: 12, color: "var(--sub)" }}>{o.table}</span>
                      <span style={{ fontSize: 12, color: "var(--sub)" }}>{o.workerName}</span>
                    </div>
                    <span className={`badge s-${o.status}`}>{STATUS_LABELS[o.status] || o.status}</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                    {(o.items || []).map((it, i) => (
                      <span key={i} style={{ fontSize: 11, background: "var(--card2)", borderRadius: 6, padding: "2px 8px" }}>
                        <ItemVisual item={store.menu.find(m=>m.id===it.itemId)||it} size={20} round={6}/> {it.itemName} ×{it.qty}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ color: "var(--sub)" }}>
                      {new Date(o.createdAt).toLocaleString("ar-SY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span style={{ fontWeight: 700, color: "#2e7d32" }}>{o.total.toLocaleString()} {CUR}</span>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ══ الفواتير ══ */}
      {adminTab === "receipts" && (
        <div className="fade-in">
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>🧾 فواتير الحديقة ({outdoorReceipts.length})</h3>
            {outdoorReceipts.length === 0
              ? <div style={{ color: "var(--sub)", textAlign: "center", padding: 24 }}>لا توجد فواتير</div>
              : outdoorReceipts.map(r => (
                <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>#{r.orderNum}</div>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>
                      {r.tableNum} —{" "}
                      {new Date(r.createdAt).toLocaleString("ar-SY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>{r.createdBy}</div>
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 900, color: "#2e7d32", fontSize: 15 }}>{(r.total || 0).toLocaleString()} {CUR}</div>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>
                      {r.paymentType === "cash" ? "💵 نقدي" : r.paymentType === "card" ? "💳 بطاقة" : r.paymentType}
                    </div>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ══ الطاولات ══ */}
      {adminTab === "tables" && (
        <div className="fade-in">
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>🪑 حالة طاولات الحديقة</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
              {outdoorTables.map(t => {
                const isBusy = t.status === "busy";
                const tOrder = outdoorOrders.find(o => o.id === t.orderId);
                return (
                  <div key={t.id} className="card" style={{
                    border: `2px solid ${isBusy ? "#e65100" : "#2e7d32"}`,
                    background: isBusy ? (dm ? "#1a1000" : "#fff8e1") : "var(--card2)",
                  }}>
                    <div style={{ textAlign: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 28 }}>🪑</div>
                      <div style={{ fontWeight: 900, fontSize: 14, color: isBusy ? "#e65100" : "#2e7d32" }}>{t.label}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isBusy ? "#e65100" : "#2e7d32" }}>
                        {isBusy ? "● مشغولة" : "○ فارغة"}
                      </div>
                    </div>
                    {isBusy && tOrder && (
                      <div style={{ fontSize: 11, color: "var(--sub)", textAlign: "center", marginBottom: 8 }}>
                        {tOrder.orderNum}<br/>
                        {tOrder.total.toLocaleString()} {CUR}
                      </div>
                    )}
                    {isBusy && (
                      <button onClick={async () => {
                        if (!window.confirm(`تحرير ${t.label} بدون دفع؟ سيتم إرجاع المخزون للبار`)) return;
                        if (tOrder && tOrder.status === "pending") {
                          store.setMenu(p => p.map(m => {
                            const ci = tOrder.items?.find(c => c.itemId === m.id);
                            if (!ci) return m;
                            const newItem = { ...m, stock: (m.stock||0)+ci.qty, totalSold: Math.max(0,(m.totalSold||0)-ci.qty) };
                            if (SUPABASE_READY) sbUpsert("menu_items",{id:newItem.id,stock:newItem.stock,total_sold:newItem.totalSold},"id").catch(()=>{});
                            return newItem;
                          }));
                          store.setOrders(p => p.map(o => o.id === tOrder.id ? {...o, status:"cancelled"} : o));
                        }
                        store.setOutdoorTables(p => p.map(x =>
                          x.id === t.id ? { ...x, status: "free", orderId: null, openedAt: null } : x
                        ));
                        showToast(`تم تحرير ${t.label} وإرجاع المخزون`, "warn");
                      }} style={{ width: "100%", padding: "7px 0", borderRadius: 8, border: "none",
                        background: "#e65100", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        تحرير
                      </button>
                    )}
                  </div>
                );
              })}
              {outdoorTables.length === 0 && (
                <div style={{ color: "var(--sub)", fontSize: 13 }}>لا توجد طاولات بعد</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ التصفير ══ */}
      {adminTab === "reset" && (
        <div className="fade-in">
          <div className="card" style={{ borderTop: "4px solid #c62828" }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, color: "#c62828" }}>⚠️ منطقة التصفير — الحديقة فقط</h3>
            <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 20 }}>
              هذه الأوامر تؤثر على بيانات الحديقة فقط ولا تمس بيانات الكفتريا الرئيسية
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
              <button onClick={resetOutdoorOrders}
                style={{ padding: 14, borderRadius: 12, border: "none", background: "#c62828", color: "#fff",
                  fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                🗑️ تصفير طلبات الحديقة
              </button>

              <button onClick={resetOutdoorReceipts}
                style={{ padding: 14, borderRadius: 12, border: "none", background: "#6a1b9a", color: "#fff",
                  fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                🗑️ تصفير فواتير الحديقة
              </button>

              <button onClick={resetOutdoorCash}
                style={{ padding: 14, borderRadius: 12, border: "none", background: "#e65100", color: "#fff",
                  fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                🗑️ تصفير كاش الحديقة
              </button>

              <button onClick={resetOutdoorTables}
                style={{ padding: 14, borderRadius: 12, border: "none", background: "#1565c0", color: "#fff",
                  fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                🪑 تحرير جميع الطاولات
              </button>

              <button onClick={resetAllOutdoor}
                style={{ padding: 14, borderRadius: 12, border: "2px solid #c62828", background: "transparent",
                  color: "#c62828", fontWeight: 900, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                  gridColumn: "1/-1" }}>
                ⚠️ تصفير شامل للحديقة (كل شيء)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
