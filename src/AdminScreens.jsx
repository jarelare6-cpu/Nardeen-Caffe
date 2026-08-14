// شاشات الإدارة — مفصولة من App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore, checkSessionExpiry, touchSession, DEFAULT_SETTINGS } from "./lib/store.js";
import { SUPABASE_READY, sbDeleteAll, sbDelete, sbUpsert, sbFetch, sbFetchDevices, logActivity } from "./lib/supabase.js";
import { deductOrderStock, restoreOrderStock, isStockDeducted } from "./lib/stock.js";
import { sendBackupNow, lastBackupAt } from "./lib/backup.js";  // v45
import RestoreBackup from "./RestoreBackup.jsx";                // v46
import { MOVE_REASONS, reasonLabel, summarizeMovements } from "./lib/stockLog.js"; // v42
import { newMoveId } from "./lib/stockLog.js"; // v43
import { fetchSalesTotals, fetchCogs, fetchExpenseTotals, fetchStaffPerformance, approxMark, approxNote } from "./lib/aggregates.js"; // v43
import { notifyTelegram, buildEventMsg, testTelegramTarget, TELEGRAM_EVENTS } from "./lib/telegram.js";

// v24.1: تأكيد كتابي عبر مودال داخلي موثوق (window.prompt معطّل في WebView/أندرويد)
// يتسامح مع كتابة "تاكيد" بألف عادية أو "تأكيد" بهمزة.
const normalizeConfirm = (s) => (s || "").trim().replace(/[أإآ]/g, "ا");
const isConfirmWord = (s) => normalizeConfirm(s) === "تاكيد";

function DangerConfirmModal({ open, label, onConfirm, onCancel }) {
  const [val, setVal] = useState("");
  useEffect(() => { if (open) setVal(""); }, [open]);
  if (!open) return null;
  const ok = isConfirmWord(val);
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", zIndex: 100000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--card,#1a1c2e)", color: "var(--text,#fff)", borderRadius: 16, padding: 22, width: "100%", maxWidth: 360, border: "2px solid #c62828" }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: "#ff5252", marginBottom: 6 }}>⚠️ {label}</div>
        <div style={{ fontSize: 12.5, color: "var(--sub,#aaa)", marginBottom: 14, lineHeight: 1.6 }}>
          هذا الإجراء لا يمكن التراجع عنه. للمتابعة اكتب كلمة <b style={{ color: "#ff5252" }}>تأكيد</b> ثم اضغط تنفيذ.
        </div>
        <input autoFocus value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && ok) onConfirm(); }}
          placeholder="اكتب: تأكيد"
          style={{ width: "100%", padding: "11px 12px", fontSize: 15, fontWeight: 700, textAlign: "center", borderRadius: 10, border: ok ? "2px solid #2e7d32" : "2px solid var(--border,#33365a)", background: "var(--card2,#23253a)", color: "var(--text,#fff)", fontFamily: "'Tajawal',sans-serif", marginBottom: 14, outline: "none" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid var(--border,#33365a)", background: "var(--card2,#23253a)", color: "var(--text,#fff)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>إلغاء</button>
          <button onClick={() => ok && onConfirm()} disabled={!ok} style={{ flex: 2, padding: 12, borderRadius: 10, border: "none", background: ok ? "#c62828" : "#555", color: "#fff", fontWeight: 900, fontSize: 14, cursor: ok ? "pointer" : "not-allowed", opacity: ok ? 1 : .6, fontFamily: "inherit" }}>🗑 تنفيذ التصفير</button>
        </div>
      </div>
    </div>
  );
}

// hook: يعطي trigger(label, action) + عنصر المودال للعرض
function useDangerConfirm() {
  const [state, setState] = useState(null); // { label, action }
  const trigger = (label, action) => setState({ label, action });
  const modal = (
    <DangerConfirmModal
      open={!!state}
      label={state?.label || ""}
      onCancel={() => setState(null)}
      onConfirm={() => { const a = state?.action; setState(null); if (a) a(); }}
    />
  );
  return { trigger, modal };
}

// ══════════════════════════════════════════════════════════════════════
// v46 — التصفير يتطلّب نسخة احتياطية حديثة
// ──────────────────────────────────────────────────────────────────────
// أزرار التصفير تمحو نهائياً بلا رجعة، وحارسها نافذة تأكيد واحدة. وهذه
// هي الكارثة الوحيدة في المشروع التي لا تُصلَح: السرقة تأخذ جزءاً،
// وفقدان البيانات يأخذ التاريخ كله.
//
// القفل لا يمنع التصفير — يمنع التصفير *الأعمى*. نقبل أي نسخة: إرسال
// تليجرام أو تنزيل يدوي، أيّهما أحدث.
// ══════════════════════════════════════════════════════════════════════
const BACKUP_MAX_AGE = 7 * 86400000;

export const freshestBackupAt = () => {
  const a = lastBackupAt();
  let b = null; try { b = localStorage.getItem("nc_last_backup"); } catch {}
  const times = [a, b].map(v => (v ? new Date(v).getTime() : NaN)).filter(t => !isNaN(t));
  return times.length ? Math.max(...times) : null;
};

const guardedReset = (rawTrigger, showToast) => (label, action) => {
  const t = freshestBackupAt();
  if (t == null) {
    showToast?.("🔒 لا توجد نسخة احتياطية — خُذ نسخة أولاً قبل أي تصفير", "error");
    return;
  }
  if (Date.now() - t > BACKUP_MAX_AGE) {
    const days = Math.floor((Date.now() - t) / 86400000);
    showToast?.(`🔒 آخر نسخة احتياطية منذ ${days} يوماً — خُذ نسخة حديثة قبل التصفير`, "error");
    return;
  }
  rawTrigger(label, action);
};
import OutdoorScreen from "./OutdoorScreen.jsx";
import { playOrderAlert, exportToExcel, generateTableQR, checkStockAlerts, notifyLowStock, sendReceiptWhatsApp, printKitchenTicket, getLoyaltyStatus, calcLoyaltyDiscount, getPartialPaymentStatus, getStaffReport, getPeakHoursData, getSalesComparison, calcShiftSummary, getOrderUrgency, getAvgPrepTime, calcEarnedPoints, getCustomerTier, pointsToValue, SOUND_TONES, calcNetProfit, businessDayStart, workDayStart, weekStartThursday, orderCash, orderTron, orderSale, orderCogs, businessDayKey, businessDayEnd, formatDayKey, listBusinessDays, closedShiftsOfDay, sumShifts, ordersOfShifts, DAY_START_UTC_HOUR } from "./lib/utils.js";
import { ROLES, ROLE_LABELS, ROLE_COLORS, ORDER_STATUS, STATUS_LABELS, STATUS_COLORS, CAT_LABELS, CAT_ORDER, BAR_CATS, HOOKAH_CATS, STATION_CATS, PERMISSIONS, THEMES, catOf, orderFullyPrepared, canAccess } from "./constants.js";
import { ItemVisual, BottomNav, GlobalStyle, Toast, PWABanner, OrderTimer } from "./uikit.jsx";
import { printOrder, generateReceiptPDF, saveReceiptRecord, saveReceipt } from "./receipts.js";
import { IMAGE_LIBRARY, AUTO_MAP } from "./lib/imageLibrary.js";

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

// ══════════════════════════════════════════════════════════════
// v44 — مؤقّت الطاولة في نطاق الوحدة
// ──────────────────────────────────────────────────────────────
// كان معرَّفاً داخل جسم المكوّن الأب، فيُهدم ويُبنى مع كل رندر. ولأن
// الأب كان يُرندَر كل ثانية، كان setInterval يُلغى قبل أن يُطلق نبضته
// الأولى: المؤقّت يبدو *واقفاً* عند قيمته الأولى، مع دورة إنشاء/إلغاء
// مؤقّتات لا تنتهي. الآن هويته ثابتة فيعيش ويعدّ فعلاً.
// ══════════════════════════════════════════════════════════════
const TableTimer = React.memo(function TableTimer({ openedAt, alertOn, alertMinutes }) {
  const startSecs = () => {
    const t = new Date(openedAt).getTime();
    return isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 1000));
  };
  const [elapsed, setElapsed] = useState(startSecs);
  useEffect(() => {
    setElapsed(startSecs());
    const t = setInterval(() => setElapsed(startSecs()), 1000); // من الساعة لا بالعدّ — لا انحراف
    return () => clearInterval(t);
  }, [openedAt]);
  const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60);
  const overLimit = alertOn && m + h * 60 >= alertMinutes;
  return (
    <span style={{ fontSize: 11, color: overLimit ? "#c62828" : "#f9a825", fontWeight: 700,
      background: overLimit ? "rgba(198,40,40,.12)" : "transparent", borderRadius: 6, padding: overLimit ? "2px 6px" : "0" }}>
      {overLimit ? "⚠ تجاوز الحد! " : "⏱ "}{h > 0 ? `${h}س ` : ""}{m}د
    </span>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// v43 — لوحة التحكم، مُعاد تنظيمها
// ───────────────────────────────────────────────────────────────────────
// كانت تسع بطاقات متجاورة بلا تجميع: إيراد كل الوقت، مبيعات اليوم، ربح،
// طلبات معلّقة، ديون، مصاريف، مخزون — مالي وتشغيلي وتحذيري في صفٍّ واحد.
// الآن أربعة أقسام صريحة: يوم العمل · الإيراد · النفقات · سجل العمل.
//
// وأُصلحت ثلاث علل:
//  ١) بطاقتا «كل الوقت» كانتا تحسبان آخر 500 طلب فقط ثم تسمّيانه إجمالي
//     المشروع. صارتا تُجمَّعان في القاعدة (تشملان الأرشيف)، وإن تعذّر
//     التجميع يُوسَم الرقم بـ«≈» صراحةً بدل الكذب الصامت.
//  ٢) الترويسة كانت تعرض تاريخ الجهاز المحلي فوق أرقام يوم غرينتش، فبين
//     منتصف الليل و3 فجراً دمشق يظهر عنوان يوم غير الأرقام تحته.
//  ٣) الرسم البياني كان بساعات الجهاز المحلي، فنافذته تعبر يومين محاسبيين.
// ═══════════════════════════════════════════════════════════════════════
export function DashboardTab({store,dm,settings,user}){
  const CUR=settings?.currency||"ل.س";
  const [devices,setDevices]=useState([]);
  const [showAllDev,setShowAllDev]=useState(false);
  const [totals,setTotals]=useState(null);        // إجماليات الخادم (كل الوقت)
  const [totalCogs,setTotalCogs]=useState(null);

  useEffect(()=>{
    let active=true;
    const load=async()=>{ try{ const d=await sbFetchDevices(); if(active) setDevices(d||[]); }catch{} };
    load(); const iv=setInterval(load,30000);
    return ()=>{ active=false; clearInterval(iv); };
  },[]);

  // v43: الإجماليات من القاعدة — رقم صحيح مهما كبر التاريخ
  useEffect(()=>{
    let alive=true;
    Promise.all([
      fetchSalesTotals(store.orders,{}),
      fetchCogs(store.orders,store.menu,{}),
    ]).then(([t,c])=>{ if(alive){ setTotals(t); setTotalCogs(c); } }).catch(()=>{});
    return ()=>{ alive=false; };
  },[store.orders.length,store.menu.length]);

  const dayStart=useMemo(()=>businessDayStart(),[]);
  const dayEndTs=useMemo(()=>businessDayEnd().getTime(),[]);
  const dayKey=useMemo(()=>businessDayKey(),[]);

  const inDay=useCallback((iso)=>{
    if(!iso) return false;
    const t=new Date(iso).getTime();
    return t>=dayStart.getTime() && t<dayEndTs;
  },[dayStart,dayEndTs]);

  // ── حسابات اليوم (مُذكَّرة — كانت تُعاد عند كل عرض) ──
  const d=useMemo(()=>{
    const paid=store.orders.filter(o=>o.status==="paid"&&!o.isComplimentary&&inDay(o.paidAt||o.createdAt));
    const sum=(a,f)=>a.reduce((s,o)=>s+f(o),0);
    const sales=sum(paid,orderSale);
    const cogs=paid.reduce((s,o)=>s+orderCogs(o,store.menu),0);
    const expenses=(store.expenses||[]).filter(e=>!e.isSecondary&&!e.isComplimentary&&inDay(e.date)).reduce((s,e)=>s+(e.amount||0),0);
    const comps=store.orders.filter(o=>inDay(o.paidAt||o.createdAt)).reduce((s,o)=>s+(o.compAmount||0),0);
    return {
      paid, sales, cogs, expenses, comps,
      cash: sum(paid.filter(o=>o.paymentType==="cash"),orderSale),
      card: sum(paid.filter(o=>o.paymentType==="card"),orderSale),
      tron: sum(paid,orderTron),
      avg:  paid.length?Math.round(sales/paid.length):0,
      debtsToday: sum(store.orders.filter(o=>o.status==="debt"&&inDay(o.createdAt)),o=>o.total||0),
      profit: sales-cogs-expenses,
    };
  },[store.orders,store.menu,store.expenses,inDay]);

  // ── التشغيل ──
  const ops=useMemo(()=>{
    const act=store.orders.filter(o=>["pending","preparing","ready"].includes(o.status));
    const tables=new Set(act.map(o=>String(o.table||"").trim()).filter(Boolean));
    const done=store.orders.filter(o=>o.readyAt&&o.createdAt&&inDay(o.createdAt));
    const avgPrep=done.length?Math.round(done.reduce((s,o)=>s+(new Date(o.readyAt)-new Date(o.createdAt))/60000,0)/done.length):0;
    return {
      pending:   act.filter(o=>o.status==="pending").length,
      preparing: act.filter(o=>o.status==="preparing").length,
      ready:     act.filter(o=>o.status==="ready").length,
      tables:    tables.size,
      avgPrep,
    };
  },[store.orders,inDay]);

  const shiftState=useMemo(()=>{
    const closed=closedShiftsOfDay(store.shifts,dayKey,null);
    const open=(store.shifts||[]).filter(s=>s.status==="open");
    return {closed,open};
  },[store.shifts,dayKey]);

  const unsettledDebts=useMemo(()=>store.debts.filter(x=>!x.settled).reduce((s,x)=>s+x.remaining,0),[store.debts]);
  const lowStock=useMemo(()=>checkStockAlerts(store.menu),[store.menu]);
  const topItems=useMemo(()=>store.menu.slice().sort((a,b)=>b.totalSold-a.totalSold).slice(0,5),[store.menu]);
  const recentActivity=useMemo(()=>(store.stockMoves||[]).slice(0,6),[store.stockMoves]);

  // v43: الرسم البياني بساعات غرينتش داخل اليوم المحاسبي الواحد
  const hourly=useMemo(()=>{
    const buckets=Array.from({length:24},(_,i)=>({h:i,rev:0}));
    store.orders.forEach(o=>{
      if(o.status!=="paid"||o.isComplimentary) return;
      const iso=o.paidAt||o.createdAt; if(!inDay(iso)) return;
      buckets[new Date(iso).getUTCHours()].rev+=orderSale(o);
    });
    return buckets;
  },[store.orders,inDay]);
  const maxRev=Math.max(...hourly.map(x=>x.rev),1);

  const n=(v)=>(+v||0).toLocaleString();
  const Money=({v,c,approx})=>(<span style={{color:c,fontWeight:900}}>{approx?"≈ ":""}{n(v)} <span style={{fontSize:10,fontWeight:700}}>{CUR}</span></span>);

  const Section=({icon,title,note,color,children})=>(
    <div className="card" style={{marginBottom:14,borderTop:`4px solid ${color}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:12,gap:10,flexWrap:"wrap"}}>
        <h3 style={{fontSize:15,fontWeight:900}}>{icon} {title}</h3>
        {note&&<span style={{fontSize:10.5,color:"var(--sub)",fontWeight:600}}>{note}</span>}
      </div>
      {children}
    </div>
  );

  const Cell=({label,value,color,sub})=>(
    <div style={{background:"var(--card2)",borderRadius:10,padding:"10px 12px"}}>
      <div style={{fontSize:11,color:"var(--sub)",marginBottom:5,fontWeight:600}}>{label}</div>
      <div style={{fontSize:16,fontWeight:900,color:color||"var(--text)"}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:"var(--sub)",marginTop:3}}>{sub}</div>}
    </div>
  );
  const grid={display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:9};
  const typeLbl=(t)=>t==="night"?"ليلية":t==="evening"?"مسائية":t==="morning"?"صباحية":"—";

  return(
    <div className="fade-in">
      <h2 style={{fontSize:20,fontWeight:900,marginBottom:14}}>📊 لوحة التحكم</h2>

      {/* ══ ١) يوم العمل ══ */}
      <Section icon="🗓" title="يوم العمل" color="#1565c0"
        note="اليوم المحاسبي بتوقيت غرينتش — مستقلّ عن توقيت الجهاز">
        <div style={{fontSize:15,fontWeight:800,marginBottom:10}}>{formatDayKey(dayKey)}</div>
        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
          {shiftState.closed.length===0&&shiftState.open.length===0&&(
            <span style={{fontSize:12,color:"var(--sub)"}}>لا ورديات بعد في هذا اليوم</span>
          )}
          {/* v44: بلا أسماء موظفين — الموظف يتغيّر والاسم يصير قديماً.
              اللوحة تُظهر حالة الوردية لا مَن يشغّلها. أسماء المنفّذين
              في «الورديات ▸ الموظفون» وفي سجل النشاط حيث تُدقَّق. */}
          {shiftState.closed.map(s=>(
            <span key={s.id} style={{background:"rgba(46,125,50,.15)",color:"#2e7d32",borderRadius:20,padding:"4px 12px",fontSize:11.5,fontWeight:800}}>
              ✓ {typeLbl(s.shiftType)}{(s.branch||"main")==="outdoor"?" · حديقة":""} — {n(s.totalSales)}
            </span>
          ))}
          {shiftState.open.map(s=>{
            const hrs=s.openedAt?Math.floor((Date.now()-new Date(s.openedAt).getTime())/3600000):0;
            const stale=hrs>=(settings?.shiftMaxHours||12);
            return(
              <span key={s.id} style={{background:stale?"rgba(198,40,40,.15)":"rgba(230,81,0,.15)",color:stale?"#c62828":"#e65100",borderRadius:20,padding:"4px 12px",fontSize:11.5,fontWeight:800}}>
                ● {typeLbl(s.shiftType)} — {(s.branch||"main")==="outdoor"?"🌿 الحديقة":"☕ الكافيه"} مفتوحة منذ {hrs} ساعة
              </span>
            );
          })}
        </div>
        {shiftState.open.length>0&&(()=>{
          const stale=shiftState.open.filter(s=>s.openedAt&&(Date.now()-new Date(s.openedAt).getTime())/3600000>=(settings?.shiftMaxHours||12));
          return(
            <div style={{fontSize:10.5,color:stale.length?"#c62828":"var(--sub)",marginTop:9,lineHeight:1.7}}>
              الوردية المفتوحة لا تدخل الجرد اليومي — تدخل جرد اليوم الذي تُقفَل فيه.
              {stale.length>0&&(
                <><br/><strong>⚠ وردية متجاوزة للمدة المعتادة — رُبّما تُركت مفتوحة سهواً.
                افتح «الورديات ▸ تقفيل» وستجد زر الانتقال إليها حتى لو كانت على فرع آخر.</strong></>
              )}
            </div>
          );
        })()}
      </Section>

      {/* ══ ٢) الإيراد ══ */}
      <Section icon="💰" title="الإيراد" color="#2e7d32" note="اليوم المحاسبي الجاري">
        <div style={grid}>
          <Cell label="المبيعات"       value={<Money v={d.sales} c="#2e7d32"/>} sub={`${d.paid.length} فاتورة`}/>
          <Cell label="نقدي"           value={<Money v={d.cash} c="#1565c0"/>}/>
          <Cell label="بطاقة"          value={<Money v={d.card} c="#0288d1"/>}/>
          <Cell label="ترون (إكراميات)" value={<Money v={d.tron} c="#6a1b9a"/>} sub="فوق الفاتورة"/>
          <Cell label="متوسط الفاتورة"  value={<Money v={d.avg} c="var(--text)"/>}/>
        </div>
      </Section>

      {/* ══ ٣) النفقات والالتزامات ══ */}
      <Section icon="📒" title="النفقات والالتزامات" color="#c62828" note="اليوم المحاسبي الجاري">
        <div style={grid}>
          <Cell label="مصاريف اليوم"     value={<Money v={d.expenses} c="#c62828"/>}/>
          <Cell label="تكلفة البضاعة"    value={<Money v={d.cogs} c="#e65100"/>} sub="المباع اليوم"/>
          <Cell label="ضيافة اليوم"      value={<Money v={d.comps} c="#00897b"/>} sub="تكلفة لا إيراد"/>
          <Cell label="ديون اليوم"       value={<Money v={d.debtsToday} c="#6a1b9a"/>}/>
          <Cell label="ديون غير مسدّدة"  value={<Money v={unsettledDebts} c="#6a1b9a"/>} sub="تراكمي"/>
          <Cell label="صافي ربح اليوم"   value={<Money v={d.profit} c={d.profit>=0?"#2e7d32":"#c62828"}/>} sub="مبيعات − تكلفة − مصاريف"/>
        </div>
      </Section>

      {/* ══ ٤) سجل العمل ══ */}
      <Section icon="📋" title="سجل العمل" color="#f9a825" note="الحالة التشغيلية الآن">
        <div style={grid}>
          <Cell label="طلبات معلّقة"    value={ops.pending}   color="#f9a825"/>
          <Cell label="قيد التحضير"     value={ops.preparing} color="#1976d2"/>
          <Cell label="جاهزة للدفع"     value={ops.ready}     color="#2e7d32"/>
          <Cell label="طاولات مشغولة"   value={ops.tables}    color="#c62828"/>
          <Cell label="متوسط التحضير"   value={`${ops.avgPrep} د`} color="var(--text)"/>
          <Cell label="مخزون منخفض"     value={lowStock.length} color={lowStock.length>0?"#c62828":"#2e7d32"} sub="صنف"/>
        </div>
        {recentActivity.length>0&&(
          <div style={{marginTop:12,paddingTop:10,borderTop:"1px dashed var(--border)"}}>
            <div style={{fontSize:11.5,fontWeight:800,color:"var(--sub)",marginBottom:7}}>آخر حركات المخزون</div>
            {recentActivity.map(m=>(
              <div key={m.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",color:"var(--sub)"}}>
                {/* v44: بلا أسماء في اللوحة — الأسماء في «سجل المخزون» حيث تُدقَّق */}
                <span>{m.delta>0?"➕":"➖"} {m.itemName}</span>
                <span style={{fontWeight:800,color:m.delta>0?"#2e7d32":"#c62828"}}>
                  {m.delta>0?"+":""}{m.delta} · {reasonLabel(m.reason)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ══ الإجماليات التراكمية ══ */}
      <Section icon="💎" title="الإجماليات التراكمية" color="#6a1b9a"
        note={totals?(totals.exact?"محسوبة في القاعدة — تشمل الأرشيف":approxNote(false)):"جارٍ الحساب..."}>
        <div style={grid}>
          <Cell label="إجمالي المبيعات" value={<Money v={totals?.revenue||0} c="#6a1b9a" approx={totals&&!totals.exact}/>}
                sub={totals?`${n(totals.ordersCount)} فاتورة`:""}/>
          <Cell label="صافي الربح"      value={<Money v={(totals?.revenue||0)-(totalCogs?.cogs||0)} c="#00897b" approx={totals&&!totals.exact}/>}
                sub="المبيعات − التكلفة"/>
          <Cell label="إجمالي الترون"   value={<Money v={totals?.tronTotal||0} c="#6a1b9a" approx={totals&&!totals.exact}/>}/>
          <Cell label="إجمالي الضيافة"  value={<Money v={totals?.compTotal||0} c="#00897b" approx={totals&&!totals.exact}/>}/>
        </div>
      </Section>

      {/* ══ الرسم البياني ══ */}
      <div className="card" style={{marginBottom:14}}>
        <h3 style={{fontSize:14,fontWeight:800,marginBottom:12}}>
          📈 الإيراد بالساعة <span style={{fontSize:10,fontWeight:600,color:"var(--sub)"}}>(بتوقيت غرينتش — 0 UTC = 3 فجراً دمشق)</span>
        </h3>
        <div style={{display:"flex",alignItems:"flex-end",gap:2,height:80}}>
          {hourly.map((x,i)=>(
            <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <div title={`${x.h}:00 UTC — ${n(x.rev)} ${CUR}`}
                style={{width:"100%",background:x.rev>0?"#c62828":dm?"#2a2d4a":"#eee",
                  borderRadius:"3px 3px 0 0",height:`${(x.rev/maxRev)*64+(x.rev>0?4:0)}px`,
                  minHeight:3,transition:"height .5s"}}/>
              {i%3===0&&<div style={{fontSize:7.5,color:"var(--sub)"}}>{x.h}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ══ الأجهزة المتصلة ══ */}
      {devices.length>0&&(()=>{
        const list=devices.slice().sort((a,b)=>new Date(b.last_seen)-new Date(a.last_seen));
        const isOn=(x)=>x.online&&(Date.now()-new Date(x.last_seen).getTime())<90000;
        const onCount=list.filter(isOn).length;
        const shown=showAllDev?list:list.slice(0,4);
        return(
          <div className="card" style={{marginBottom:14,borderTop:"3px solid #1565c0"}}>
            <h3 style={{fontSize:14,fontWeight:800,marginBottom:12}}>📡 الأجهزة المتصلة ({onCount}/{list.length})</h3>
            {shown.map(x=>(
              <div key={x.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",fontSize:12}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:isOn(x)?"#2e7d32":"#999",flexShrink:0}}/>
                <span style={{flex:1,fontWeight:600}}>{x.label||x.id}</span>
                <span style={{color:"var(--sub)",fontSize:10.5}}>{ROLE_LABELS[x.role]||x.role||""}</span>
              </div>
            ))}
            {list.length>4&&(
              <button onClick={()=>setShowAllDev(v=>!v)}
                style={{marginTop:8,background:"none",border:"none",color:"#1565c0",fontWeight:700,fontSize:11.5,cursor:"pointer",fontFamily:"inherit"}}>
                {showAllDev?"▲ أقلّ":`▼ عرض الكل (${list.length})`}
              </button>
            )}
          </div>
        );
      })()}

      {/* ══ الأكثر مبيعاً + تحذيرات المخزون ══ */}
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
                  <div style={{width:`${Math.min(100,(item.stock/Math.max(item.minStock,1))*100)}%`,
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
  const today = workDayStart(store.shifts); // v37

  const todayPaid=store.orders.filter(o=>o.status==="paid"&&new Date(o.paidAt||o.createdAt)>=today);
  const todayRevenue=todayPaid.reduce((s,o)=>s+orderSale(o),0); // v39: مبيعات كاملة

  // الترون اليوم — بند منفصل تماماً (لا يدخل الجرد ولا الإيراد)
  const tronToday=todayPaid.reduce((s,o)=>s+orderTron(o),0);

  // مصاريف عادية (تدخل الجرد) — الضيافة لا تدخل المصاريف بعد الآن
  const primaryExp=(store.expenses||[]).filter(e=>!e.isSecondary&&!e.isComplimentary&&new Date(e.date)>=today);
  const primaryTotal=primaryExp.reduce((s,e)=>s+e.amount,0);

  // مصاريف ثانوية (لا تدخل الجرد)
  const secondaryExp=(store.expenses||[]).filter(e=>e.isSecondary&&new Date(e.date)>=today);
  const secondaryTotal=secondaryExp.reduce((s,e)=>s+e.amount,0);

  // v36: الجرد = الإيراد النقدي − المصروف اليومي (الترون مستبعَد ومعروض منفصلاً)
  const net=todayRevenue-primaryTotal;

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
              <span style={{fontWeight:700,color:"#2e7d32"}}>{orderCash(o).toLocaleString()} {CUR}{orderTron(o)>0?<span style={{color:"#6a1b9a",fontWeight:700}}> · 💠{orderTron(o).toLocaleString()}</span>:""}</span>
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
          {todayRevenue.toLocaleString()} إيرادات نقدية − {primaryTotal.toLocaleString()} مصاريف · 💠 {tronToday.toLocaleString()} ترون منفصل
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


export function MenuTab({store,showToast,dm,settings,user}){
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

  const filtered=(cat==="all"?store.menu:store.menu.filter(m=>m.category===cat)).filter(m=>!m.noStock||cat==="services"); // v24

  const save=()=>{
    if(!form.name||!form.price){showToast("يرجى ملء الحقول الأساسية","error");return}
    if(editItem){
      store.setMenu(p=>p.map(m=>m.id===editItem.id?{...m,...form,price:+form.price,stock:+form.stock,minStock:+form.minStock,cost:+form.cost||0}:m));
      // ══════════════════════════════════════════════════════════════
      // v45 — تغيير السعر يُسجَّل (قبل→بعد)
      // الحيلة الأخطر في أي مقهى ليست الإلغاء: خفّض السعر، بِع، أعِد
      // السعر، اقبض الفارق. كانت تمرّ بلا أي أثر. التبويب للأدمن فقط
      // أصلاً، لكن السجل يجعل الفعل مرئياً حتى من الأدمن نفسه.
      // ══════════════════════════════════════════════════════════════
      try{
        const chg=[];
        if(+editItem.price!==+form.price) chg.push(`السعر ${(+editItem.price||0).toLocaleString()}→${(+form.price||0).toLocaleString()}`);
        if(+(editItem.cost||0)!==(+form.cost||0)) chg.push(`التكلفة ${(+editItem.cost||0).toLocaleString()}→${(+form.cost||0).toLocaleString()}`);
        if((editItem.name||"")!==form.name) chg.push(`الاسم ${editItem.name}→${form.name}`);
        if(chg.length) logActivity({action:"تغيير سعر صنف",details:`${editItem.name} — ${chg.join(" • ")}`,
          userName:user?.name||"أدمن",userRole:user?.role||"admin",amount:+form.price||0,branch:"main"});
      }catch{}
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
              <button onClick={()=>{
                store.setMenu(p=>p.filter(m=>m.id!==item.id));
                try{ logActivity({action:"حذف صنف",details:`${item.name} — ${(+item.price||0).toLocaleString()} • مخزون ${item.stock??0}`,userName:user?.name||"أدمن",userRole:user?.role||"admin",amount:+item.price||0,branch:"main"}); }catch{}
                showToast("تم حذف الصنف");
              }}
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
  const [payModal, setPayModal] = useState(null); // v24.2: تأكيد الدفع الكامل (بدل window.confirm المعطّل بأندرويد)
  const [xferModal, setXferModal] = useState(false); // v30: نقل فاتورة بين الطاولات
  const [xFrom, setXFrom] = useState(""); const [xTo, setXTo] = useState(""); const [xPicked, setXPicked] = useState({});
  const CUR = settings?.currency || "ل.س";
  const canManage = user && ["admin", "cashier"].includes(user.role);
  const isAdmin = user?.role === "admin";
  const alertMinutes = settings?.tableAlertMinutes || 60;
  const tableTimerAlert = settings?.tableTimerAlert || false;

  // v41: حُذف toggleStatus — الإشغال مُشتقّ من الطلبات النشطة ولا يُبدَّل يدوياً.

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
    // v41: الطاولة تتحرر من نفسها (إشغال مُشتقّ) — لا كتابة حالة
    showToast(`🪑 تم تفريغ ${t.label} وإعادة المخزون`);
  };

  // v24.2: تنفيذ الدفع الكامل بعد التأكيد من المودال
  const doPayFull = () => {
    if (!payModal) return;
    const { table: t, tOrders, total } = payModal;
    setPayModal(null);
    if (typeof navigator !== "undefined" && navigator.onLine === false) { showToast("⚠ لا يوجد اتصال — لا يمكن الدفع", "error"); return; }
    const now = new Date().toISOString();
    const updated = store.orders.map(o =>
      tOrders.find(x => x.id === o.id)
        ? { ...o, status: "paid", paymentType: "cash", paidAt: now, stockDeducted: true }
        : o
    );
    store.setOrders(() => updated);
    tOrders.forEach(o => deductOrderStock(store, o));
    // v41: الطاولة تتحرر من نفسها (إشغال مُشتقّ)
    logActivity({ action: "دفع طلب", details: `دفع كامل طاولة ${t.number} (${tOrders.length} طلب)`, userName: user?.name || "", userRole: user?.role || "admin", orderNum: "", amount: total, branch: "main" });
    showToast(`✓ تم دفع طاولة ${t.number} — ${total.toLocaleString()} ${CUR}`);
  };

  // v30: نقل فاتورة/فواتير من طاولة إلى أخرى (يتبع الفاتورة لا الطاولة كاملة)
  const ACTIVE_ST = ["paid", "cancelled", "debt", "complimentary"];
  const xferFromOrders = store.orders.filter(o => String(o.table) === String(xFrom.trim()) && !ACTIVE_ST.includes(o.status));
  const doTransfer = () => {
    const from = xFrom.trim(), to = xTo.trim();
    if (!from || !to) { showToast("أدخل الطاولة الحالية والجديدة", "error"); return; }
    if (from === to) { showToast("الطاولتان متطابقتان", "error"); return; }
    const picked = xferFromOrders.filter(o => xPicked[o.id]);
    if (!picked.length) { showToast("أشّر فاتورة واحدة على الأقل", "error"); return; }
    // منع النقل لو الطاولة الجديدة مشغولة بأي طلب نشط
    const toBusy = store.orders.some(o => String(o.table) === String(to) && !ACTIVE_ST.includes(o.status));
    if (toBusy) { showToast(`⚠ الطاولة ${to} مشغولة — لا يمكن النقل إليها`, "error"); return; }
    const ids = new Set(picked.map(o => o.id));
    // v41: النقل صار يُزامَن فعلاً — كان كاشف التغيير في setOrders يُسقط الحقل
    // `table` فلا يصل التحديث لـ Supabase، فتعود الطلبات للطاولة الأولى بعد
    // تحديث الصفحة. الإصلاح في src/lib/store.js (مقارنة الصف كاملاً).
    // ولا حاجة لتحديث جدول الطاولات: الإشغال مُشتقّ من الطلبات النشطة.
    store.setOrders(p => p.map(o => ids.has(o.id) ? { ...o, table: to } : o));
    logActivity({ action: "نقل طاولة", details: `${picked.length} فاتورة من ط${from} ← ط${to}`, userName: user?.name || "", userRole: user?.role || "", branch: "main" });
    showToast(`🔀 نُقلت ${picked.length} فاتورة إلى طاولة ${to}`, "success");
    setXferModal(false); setXFrom(""); setXTo(""); setXPicked({});
  };

  // v31: إشغال الطاولة مشتقّ من الطلبات النشطة فقط — مصدر حقيقة واحد (يستثني الدين أيضاً)
  const activeOrders = (num) => store.orders.filter(o =>
    String(o.table) === String(num) && !["paid", "cancelled", "complimentary", "debt"].includes(o.status)
  );
  const isOccupied = (t) => activeOrders(t.number).length > 0;
  const tableOpenedAt = (t) => {
    const os = activeOrders(t.number);
    if (!os.length) return null;
    return os.reduce((min, o) => (!min || new Date(o.createdAt) < new Date(min)) ? o.createdAt : min, null);
  };
  const free = store.tables.filter(t => !isOccupied(t)).length;
  const occupied = store.tables.filter(t => isOccupied(t)).length;

  return (
    <div className="fade-in">
      {/* v24.2: Modal تأكيد الدفع الكامل */}
      {xferModal && (
        <div onClick={() => setXferModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 420, maxHeight: "88vh", overflowY: "auto" }}>
            <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 4 }}>🔀 نقل فاتورة بين الطاولات</h3>
            <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 14 }}>تنتقل الفواتير المؤشّرة فقط — الطاولة القديمة تتحرر إن لم يبقَ عليها طلب.</div>

            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 4 }}>الطاولة الحالية</label>
            <input className="input" inputMode="numeric" placeholder="رقم الطاولة الحالية" value={xFrom}
              onChange={e => { setXFrom(e.target.value); setXPicked({}); }} style={{ marginBottom: 12 }} />

            {xFrom.trim() && (
              xferFromOrders.length === 0 ? (
                <div style={{ fontSize: 13, color: "#c62828", marginBottom: 12 }}>لا توجد فواتير نشطة على هذه الطاولة.</div>
              ) : (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", marginBottom: 6 }}>أشّر الفواتير المراد نقلها:</div>
                  {xferFromOrders.map(o => (
                    <label key={o.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, marginBottom: 6, cursor: "pointer", background: xPicked[o.id] ? "rgba(106,27,154,.12)" : "var(--card2)", border: xPicked[o.id] ? "1.5px solid #6a1b9a" : "1.5px solid var(--border)" }}>
                      <input type="checkbox" checked={!!xPicked[o.id]} onChange={e => setXPicked(p => ({ ...p, [o.id]: e.target.checked }))} style={{ width: 18, height: 18, accentColor: "#6a1b9a", flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>#{o.orderNum} — {o.customerName || "بلا اسم"}</div>
                        <div style={{ fontSize: 11, color: "var(--sub)" }}>{(o.items || []).length} صنف</div>
                      </div>
                      <span style={{ fontWeight: 800, color: "#6a1b9a", fontSize: 13 }}>{(o.total || 0).toLocaleString()} {CUR}</span>
                    </label>
                  ))}
                </div>
              )
            )}

            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 4 }}>الطاولة الجديدة</label>
            <input className="input" inputMode="numeric" placeholder="رقم الطاولة الجديدة" value={xTo}
              onChange={e => setXTo(e.target.value)} style={{ marginBottom: 16 }} />

            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setXferModal(false)} style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700, whiteSpace: "nowrap" }}>إلغاء</button>
              <button onClick={doTransfer} style={{ flex: 2, padding: 12, borderRadius: 10, border: "none", background: "#6a1b9a", color: "#fff", fontWeight: 800, whiteSpace: "nowrap" }}>🔀 تنفيذ النقل</button>
            </div>
          </div>
        </div>
      )}

      {payModal && (
        <div onClick={e => { if (e.target === e.currentTarget) setPayModal(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 950, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div className="card fade-in" style={{ width: "100%", maxWidth: 360 }}>
            <div style={{ textAlign: "center", fontSize: 40, marginBottom: 10 }}>💵</div>
            <h3 style={{ textAlign: "center", fontWeight: 900, marginBottom: 6 }}>دفع كامل {payModal.table.label}</h3>
            <p style={{ textAlign: "center", fontSize: 13, color: "var(--sub)", marginBottom: 14 }}>
              {payModal.tOrders.length} طلب جاهز — الإجمالي <b style={{ color: "#c62828" }}>{payModal.total.toLocaleString()} {CUR}</b>
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setPayModal(null)}
                style={{ flex: 1, background: "var(--card2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px", fontWeight: 700, cursor: "pointer", color: "var(--text)", fontFamily: "inherit" }}>
                إلغاء
              </button>
              <button onClick={doPayFull}
                style={{ flex: 2, background: "#2e7d32", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>
                ✓ تأكيد الدفع
              </button>
            </div>
          </div>
        </div>
      )}

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
          {canManage && (
            <button onClick={() => { setXferModal(true); setXFrom(""); setXTo(""); setXPicked({}); }}
              style={{ background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 10, padding: "7px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
              🔀 نقل
            </button>
          )}
          {isAdmin && (
            <button onClick={() => store.addTable && store.addTable()}
              style={{ background: "#1565c0", color: "#fff", border: "none", borderRadius: 10, padding: "7px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
              ＋ طاولة جديدة
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, width: "100%", minWidth: 0 }}>
        {store.tables
          .slice()
          .sort((a, b) => (a.number || 0) - (b.number || 0))
          .map(t => {
            const orders = activeOrders(t.number);
            const occ = orders.length > 0; // v31: مشتقّ من الطلبات
            const openedAt = occ ? tableOpenedAt(t) : null;
            const total = orders.reduce((s, o) => s + (o.total || 0), 0);
            return (
              <div key={t.id} className="card"
                style={{ borderTop: `4px solid ${occ ? "#c62828" : "#2e7d32"}`, transition: "box-shadow .2s, transform .2s", background: dm ? "#181a30" : "#ffffff", maxHeight: 460, overflow: "hidden", contain: "content" }}>
                <div style={{ position: "relative", width: 56, height: 56, margin: "0 auto 6px" }}>
                  <img src="/Table.webp" alt="طاولة" width="56" height="56"
                    style={{ width: 56, height: 56, objectFit: "contain", display: "block", filter: occ ? "none" : "none" }} />
                  <span style={{ position: "absolute", right: -2, bottom: -2, width: 14, height: 14, borderRadius: "50%", background: occ ? "#c62828" : "#2e7d32", border: "2px solid var(--card)" }} />
                </div>
                <div style={{ fontWeight: 900, textAlign: "center", fontSize: 14 }}>{t.label}</div>
                <div style={{ textAlign: "center", marginTop: 6 }}>
                  <span style={{
                    background: !occ ? "rgba(46,125,50,.15)" : "rgba(198,40,40,.15)",
                    color: !occ ? "#2e7d32" : "#c62828",
                    borderRadius: 20, padding: "3px 12px", fontSize: 12, fontWeight: 700
                  }}>
                    {!occ ? "شاغرة" : "مشغولة"}
                  </span>
                </div>
                {occ && openedAt && (
                  <div style={{ textAlign: "center", marginTop: 8 }}><TableTimer openedAt={openedAt} alertOn={tableTimerAlert} alertMinutes={alertMinutes} /></div>
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
                {canManage && occ && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={e => { e.stopPropagation();
                        // دفع كامل الطاولة
                        const tOrders = orders.filter(o => o.status === "ready");
                        if (!tOrders.length) { showToast("لا توجد طلبات جاهزة للدفع", "warn"); return; }
                        setPayModal({ table: t, tOrders, total });
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

export function CompLogTab({ store, user, showToast, dm, settings }) {
  const CUR = settings?.currency || "ل.س";
  const [period, setPeriod] = useState("today");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all"); // all | comp | worker
  const [wModal, setWModal] = useState(false);
  const [editComp, setEditComp] = useState(null); // v30: تعديل سجل ضيافة/عامل
  const [eName, setEName] = useState(""); const [eAmount, setEAmount] = useState("");
  const [selectedPerson, setSelectedPerson] = useState(null); // v37: ملف الشخص

  const getStart = () => {
    const d = new Date();
    if (period === "today") { return workDayStart(store.shifts); }
    if (period === "week") { return weekStartThursday(); }
    if (period === "month") { d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
    return new Date(0);
  };

  const kindOf = (c) => (c.reason === "worker" ? "worker" : "comp");

  const inPeriod = (store.compLog || []).filter(c => new Date(c.date) >= getStart());
  const logs = inPeriod
    .filter(c => kindFilter === "all" || kindOf(c) === kindFilter)
    .filter(c => !search || (c.customerName || "").includes(search))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // ضيافة الزبائن بقيمة البيع، مشاريب العمال بقيمة التكلفة — منفصلان دائماً
  const compTotal = inPeriod.filter(c => kindOf(c) === "comp").reduce((s, c) => s + (c.amount || 0), 0);
  const workerTotal = inPeriod.filter(c => kindOf(c) === "worker").reduce((s, c) => s + (c.amount || 0), 0);

  // v37: تجميع الضيافة حسب الشخص — ملف مستقل لكل شخص/عامل
  const nameKey = (n) => (n || "بدون اسم").trim();
  const groups = useMemo(() => {
    const m = new Map();
    logs.forEach(c => {
      const key = nameKey(c.customerName);
      if (!m.has(key)) m.set(key, { name: key, items: [], total: 0, compVal: 0, workerVal: 0, count: 0, hasWorker: false, lastDate: 0 });
      const g = m.get(key);
      g.items.push(c);
      g.total += c.amount || 0;
      if (kindOf(c) === "worker") { g.workerVal += c.amount || 0; g.hasWorker = true; } else g.compVal += c.amount || 0;
      g.count++;
      const t = new Date(c.date).getTime(); if (t > g.lastDate) g.lastDate = t;
    });
    return Array.from(m.values()).sort((a, b) => (b.total - a.total) || (b.lastDate - a.lastDate));
  }, [logs]);
  const personGroup = selectedPerson ? groups.find(g => g.name === selectedPerson) : null;
  const personItems = personGroup ? personGroup.items : [];

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900 }}>🎁 الضيافة والاستهلاك الداخلي</h2>
      </div>

      {/* بطاقتا الإجمالي المنفصلتان */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div className="card" style={{ borderTop: "4px solid #00897b", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--sub)" }}>🎁 ضيافة الزبائن</div>
          <div style={{ fontSize: 19, fontWeight: 900, color: "#00897b" }}>{compTotal.toLocaleString()} {CUR}</div>
          <div style={{ fontSize: 10, color: "var(--sub)" }}>بسعر البيع</div>
        </div>
        <div className="card" style={{ borderTop: "4px solid #5e35b1", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--sub)" }}>☕ مشاريب العمال</div>
          <div style={{ fontSize: 19, fontWeight: 900, color: "#5e35b1" }}>{workerTotal.toLocaleString()} {CUR}</div>
          <div style={{ fontSize: 10, color: "var(--sub)" }}>بسعر التكلفة</div>
        </div>
      </div>

      {/* الفترة */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {[["today","اليوم"],["week","الأسبوع"],["month","الشهر"],["all","الكل"]].map(([v,l]) => (
          <button key={v} onClick={() => setPeriod(v)}
            style={{ padding: "7px 14px", borderRadius: 20, border: "none", cursor: "pointer",
              background: period === v ? "#00897b" : "var(--card2)", color: period === v ? "#fff" : "var(--sub)",
              fontWeight: 700, fontSize: 12 }}>
            {l}
          </button>
        ))}
      </div>
      {/* النوع */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {[["all","الكل"],["comp","ضيافة زبائن"],["worker","مشاريب عمال"]].map(([v,l]) => (
          <button key={v} onClick={() => setKindFilter(v)}
            style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid var(--border)", cursor: "pointer",
              background: kindFilter === v ? (v==="worker"?"#5e35b1":"#00897b") : "transparent",
              color: kindFilter === v ? "#fff" : "var(--sub)", fontWeight: 700, fontSize: 12 }}>
            {l}
          </button>
        ))}
      </div>
      <input className="input" placeholder="🔍 ابحث بالاسم..." value={search}
        onChange={e => setSearch(e.target.value)} style={{ marginBottom: 12 }} />

      {(() => {
        // v37: بطاقة سجل ضيافة مفردة (تُستخدم داخل ملف الشخص)
        const renderCompCard = (c) => {
          const worker = kindOf(c) === "worker";
          const col = worker ? "#5e35b1" : "#00897b";
          return (
            <div key={c.id} className="card" style={{ marginBottom: 10, borderRight: `4px solid ${col}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{worker ? "☕" : "👤"} {c.customerName}
                    {worker && <span style={{ fontSize: 10, background: "#5e35b1", color: "#fff", borderRadius: 6, padding: "1px 6px", marginInlineStart: 6 }}>عامل</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--sub)" }}>
                    {c.tableNum ? `طاولة ${c.tableNum} • ` : ""}{c.orderNum ? `طلب #${c.orderNum} • ` : ""}بواسطة {c.createdBy}
                  </div>
                </div>
                <span style={{ fontWeight: 900, color: col, fontSize: 15 }}>{(c.amount || 0).toLocaleString()} {CUR}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--sub)" }}>🍽 {(c.items || []).join("، ")}</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop: 4 }}>
                <div style={{ fontSize: 11, color: "var(--sub)" }}>{new Date(c.date).toLocaleString("ar-SY")}</div>
                <button onClick={() => { setEditComp(c); setEName(c.customerName || ""); setEAmount(String(c.amount || "")); }}
                  style={{ padding: "3px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>✏ تعديل</button>
              </div>
            </div>
          );
        };

        if (selectedPerson && personGroup) {
          // ── ملف شخص واحد: يجمع مسحوباته ──
          return (
            <>
              <button onClick={() => setSelectedPerson(null)}
                style={{ background: "var(--card2)", border: "none", borderRadius: 10, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 16, fontFamily: "inherit" }}>
                ← رجوع لكل الملفّات
              </button>
              <div className="card" style={{ marginBottom: 16, borderTop: `4px solid ${personGroup.hasWorker ? "#5e35b1" : "#00897b"}` }}>
                <div style={{ fontSize: 34, textAlign: "center", marginBottom: 4 }}>{personGroup.hasWorker ? "☕" : "👤"}</div>
                <div style={{ fontWeight: 900, fontSize: 18, textAlign: "center", marginBottom: 12 }}>{personGroup.name}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  <div style={{ textAlign: "center", background: "var(--card2)", borderRadius: 10, padding: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>الإجمالي</div>
                    <div style={{ fontWeight: 900, fontSize: 15, color: "#00897b" }}>{personGroup.total.toLocaleString()} {CUR}</div>
                  </div>
                  <div style={{ textAlign: "center", background: "var(--card2)", borderRadius: 10, padding: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>عدد المسحوبات</div>
                    <div style={{ fontWeight: 900, fontSize: 18 }}>{personGroup.count}</div>
                  </div>
                  <div style={{ textAlign: "center", background: "var(--card2)", borderRadius: 10, padding: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>{personGroup.hasWorker ? "☕ عمّال" : "🎁 ضيافة"}</div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{(personGroup.hasWorker ? personGroup.workerVal : personGroup.compVal).toLocaleString()} {CUR}</div>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--sub)", marginBottom: 10 }}>📋 تفصيل المسحوبات ({personItems.length})</div>
              {personItems.map(renderCompCard)}
            </>
          );
        }

        // ── قائمة الملفّات: بطاقة لكل شخص ──
        if (!groups.length) return (
          <div style={{ textAlign: "center", padding: 60, color: "var(--sub)" }}>
            <div style={{ fontSize: 48 }}>🎁</div>
            <div style={{ marginTop: 10 }}>لا توجد سجلات</div>
          </div>
        );
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {groups.map(g => (
              <button key={g.name} onClick={() => setSelectedPerson(g.name)} className="card"
                style={{ textAlign: "right", border: "none", borderRight: `4px solid ${g.hasWorker ? "#5e35b1" : "#00897b"}`, cursor: "pointer", width: "100%", fontFamily: "inherit", display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 15 }}>{g.hasWorker ? "☕" : "👤"} {g.name}
                      {g.hasWorker && <span style={{ fontSize: 10, background: "#5e35b1", color: "#fff", borderRadius: 6, padding: "1px 6px", marginInlineStart: 6 }}>عامل</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 3 }}>
                      {g.count} مسحوب • آخر سحب {new Date(g.lastDate).toLocaleDateString("ar-SY")}
                    </div>
                  </div>
                  <div style={{ textAlign: "left", whiteSpace: "nowrap", paddingRight: 10 }}>
                    <div style={{ fontWeight: 900, fontSize: 16, color: "#00897b" }}>{g.total.toLocaleString()} {CUR}</div>
                    <div style={{ fontSize: 11, color: "var(--sub)" }}>الإجمالي ›</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        );
      })()}

      {editComp && (
        <div onClick={() => setEditComp(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 360 }}>
            <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 14 }}>✏ تعديل {kindOf(editComp) === "worker" ? "مشروب عامل" : "ضيافة"}</h3>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 4 }}>{kindOf(editComp) === "worker" ? "العامل" : "الزبون"}</label>
            <input className="input" value={eName} onChange={e => setEName(e.target.value)} style={{ marginBottom: 12 }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 4 }}>المبلغ ({CUR})</label>
            <input className="input" type="number" value={eAmount} onChange={e => setEAmount(e.target.value)} style={{ marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => {
                store.setCompLog(p => p.filter(x => x.id !== editComp.id));
                if (SUPABASE_READY) { try { sbDelete("comp_log", editComp.id); } catch {} }
                try { logActivity({ action: "حذف سجل ضيافة", details: `${editComp.customerName} — ${editComp.amount}`, userName: user?.name || "", userRole: user?.role || "", amount: editComp.amount, branch: "main" }); } catch {}
                showToast("🗑 حُذف السجل", "warn"); setEditComp(null);
              }} style={{ padding: "11px 14px", borderRadius: 10, border: "none", background: "rgba(198,40,40,.15)", color: "#c62828", fontWeight: 800, whiteSpace: "nowrap" }}>🗑 حذف</button>
              <button onClick={() => setEditComp(null)} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700 }}>إلغاء</button>
              <button onClick={() => {
                store.setCompLog(p => p.map(x => x.id === editComp.id ? { ...x, customerName: eName, amount: +eAmount || 0 } : x));
                try { logActivity({ action: "تعديل سجل ضيافة", details: `${editComp.customerName}→${eName} • ${editComp.amount}→${+eAmount || 0}`, userName: user?.name || "", userRole: user?.role || "", amount: +eAmount || 0, branch: "main" }); } catch {}
                showToast("✓ حُفظ التعديل", "success"); setEditComp(null);
              }} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "#00897b", color: "#fff", fontWeight: 800 }}>حفظ</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// v29: مودال تسجيل مشروب عامل — بسعر التكلفة، مربوط باسم العامل، يخصم المخزون، صفر تأثير على البيع
function WorkerDrinkModal({ store, user, settings, showToast, onClose }) {
  const CUR = settings?.currency || "ل.س";
  const staff = (store.users || []).filter(u => u.role !== "customer" && u.active !== false);
  const [worker, setWorker] = useState(user?.name || (staff[0]?.name || ""));
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState({}); // id -> qty

  const menu = (store.menu || []).filter(m => !m.noStock && m.active !== false);
  const filtered = menu.filter(m => m.name.includes(search) || (m.nameEn || "").toLowerCase().includes(search.toLowerCase()));

  const add = (id) => setPicked(p => ({ ...p, [id]: (p[id] || 0) + 1 }));
  const sub = (id) => setPicked(p => { const n = (p[id] || 0) - 1; const c = { ...p }; if (n <= 0) delete c[id]; else c[id] = n; return c; });

  const lines = Object.entries(picked).map(([id, qty]) => {
    const m = menu.find(x => x.id === id); return m ? { id, name: m.name, qty, cost: +m.cost || 0 } : null;
  }).filter(Boolean);
  const costTotal = lines.reduce((s, l) => s + l.cost * l.qty, 0);

  const save = () => {
    if (!worker) { showToast("اختر العامل", "warn"); return; }
    if (!lines.length) { showToast("اختر صنفاً واحداً على الأقل", "warn"); return; }
    // خصم المخزون للأصناف الحقيقية فقط (المفتوحة بلا عدّ)
    store.setMenu(p => p.map(m => {
      if (m.noStock || m.trackStock === false) return m;
      const l = lines.find(x => x.id === m.id);
      if (!l) return m;
      return { ...m, stock: Math.max(0, (m.stock || 0) - l.qty) };
    }));
    store.setCompLog(p => [{
      id: "wrk" + Date.now(),
      reason: "worker",
      customerName: worker,
      tableNum: "", orderId: null, orderNum: "",
      items: lines.map(l => `${l.name}${l.qty > 1 ? ` ×${l.qty}` : ""}`),
      amount: costTotal, // بسعر التكلفة
      date: new Date().toISOString(),
      createdBy: user?.name || "",
    }, ...p]);
    try { logActivity({ action: "مشروب عامل", details: `${worker} — ${lines.length} صنف`, userName: user?.name || "", userRole: user?.role || "", amount: costTotal, branch: "main" }); } catch {}
    showToast(`☕ سُجّل مشروب العامل — ${costTotal.toLocaleString()} ${CUR} تكلفة`, "success");
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--card)", width: "100%", maxWidth: 480, maxHeight: "88vh", borderRadius: "18px 18px 0 0", padding: 18, overflowY: "auto" }}>
        <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 12 }}>☕ تسجيل مشروب عامل</h3>

        <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 4 }}>العامل</label>
        <select value={worker} onChange={e => setWorker(e.target.value)} className="input" style={{ marginBottom: 12 }}>
          {staff.map(u => <option key={u.id} value={u.name}>{u.name} — {u.role}</option>)}
        </select>

        <input className="input" placeholder="🔍 ابحث عن صنف..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 10 }} />

        <div style={{ maxHeight: 240, overflowY: "auto", marginBottom: 12 }}>
          {filtered.slice(0, 60).map(m => {
            const q = picked[m.id] || 0;
            return (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ flex: 1, fontSize: 13 }}>{m.emoji} {m.name}
                  <span style={{ fontSize: 10, color: "var(--sub)" }}> • تكلفة {(+m.cost || 0)}</span>
                </div>
                {q > 0 && <button onClick={() => sub(m.id)} style={{ width: 26, height: 26, borderRadius: 7, border: "none", background: "rgba(198,40,40,.15)", color: "#c62828", fontWeight: 900 }}>−</button>}
                {q > 0 && <span style={{ minWidth: 18, textAlign: "center", fontWeight: 800 }}>{q}</span>}
                <button onClick={() => add(m.id)} style={{ width: 26, height: 26, borderRadius: 7, border: "none", background: "rgba(94,53,177,.15)", color: "#5e35b1", fontWeight: 900 }}>+</button>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, fontWeight: 800 }}>
          <span>إجمالي التكلفة</span>
          <span style={{ color: "#5e35b1", fontSize: 17 }}>{costTotal.toLocaleString()} {CUR}</span>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700 }}>إلغاء</button>
          <button onClick={save} style={{ flex: 2, padding: 12, borderRadius: 10, border: "none", background: "#5e35b1", color: "#fff", fontWeight: 800 }}>☕ تسجيل ({costTotal.toLocaleString()} {CUR})</button>
        </div>
      </div>
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
  const [addModal, setAddModal] = useState(false); // v31.3: إضافة زبون يدوياً
  const [nc, setNc] = useState({ name: "", phone: "", notes: "" });
  const [redeemOpen, setRedeemOpen] = useState(false); // v31.4: استبدال جزئي
  const [redeemPts, setRedeemPts] = useState("");

  const saveNewCustomer = () => {
    const name = nc.name.trim();
    if (!name) { showToast("اسم الزبون مطلوب", "error"); return; }
    if ((store.customers || []).some(c => c.name === name)) { showToast("زبون بنفس الاسم موجود", "error"); return; }
    const cust = {
      id: "cust_" + Date.now(), name, phone: nc.phone.trim(), notes: nc.notes.trim(),
      visits: 0, totalOrders: 0, totalSpent: 0, loyaltyPoints: 0, loyaltyRedeemed: 0,
      tier: "bronze", lastVisit: new Date().toISOString(), createdAt: new Date().toISOString(), orders: [],
    };
    store.setCustomers(p => [cust, ...p]);
    try { logActivity({ action: "إضافة زبون", details: name, userName: "أدمن", userRole: "admin", branch: "main" }); } catch {}
    showToast("✓ أُضيف الزبون");
    setAddModal(false); setNc({ name: "", phone: "", notes: "" });
  };

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
              setRedeemPts(String(points)); setRedeemOpen(true);
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
      {redeemOpen && selected && (() => {
        const maxPts = selected.loyaltyPoints || 0;
        const pts = Math.min(Math.max(0, Math.floor(+redeemPts || 0)), maxPts);
        const val = pointsToValue(pts, settings);
        const doRedeem = () => {
          if (pts <= 0) { showToast("أدخل عدد نقاط صحيحاً", "error"); return; }
          store.setCustomers(p => p.map(c => c.id === selected.id
            ? { ...c, loyaltyPoints: (c.loyaltyPoints || 0) - pts, loyaltyRedeemed: (c.loyaltyRedeemed || 0) + pts }
            : c));
          store.setLoyaltyLog(p => [{
            id: "loy_" + Date.now(), customerId: selected.id, customerName: selected.name,
            type: "redeem", points: -pts, orderId: null, orderNum: "",
            note: `استبدال ${pts} نقطة بـ ${val.toLocaleString()} ${CUR}`,
            createdBy: "أدمن", createdAt: new Date().toISOString(),
          }, ...p]);
          setSelected(s => ({ ...s, loyaltyPoints: (s.loyaltyPoints || 0) - pts, loyaltyRedeemed: (s.loyaltyRedeemed || 0) + pts }));
          try { logActivity({ action: "استبدال نقاط", details: `${selected.name} — ${pts} نقطة (${val} ${CUR})`, userName: "أدمن", userRole: "admin", amount: val, branch: "main" }); } catch {}
          showToast(`🎁 استُبدلت ${pts} نقطة — امنح الزبون خصم ${val.toLocaleString()} ${CUR}`);
          setRedeemOpen(false);
        };
        return (
          <div onClick={() => setRedeemOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 340 }}>
              <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 4, textAlign: "center" }}>🎁 استبدال نقاط</h3>
              <p style={{ fontSize: 12, color: "var(--sub)", textAlign: "center", marginBottom: 14 }}>{selected.name} — متاح {maxPts.toLocaleString()} نقطة</p>
              <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 4 }}>عدد النقاط المراد استبدالها</label>
              <input className="input" type="number" min="1" max={maxPts} value={redeemPts}
                onChange={e => setRedeemPts(e.target.value)} style={{ fontSize: 18, fontWeight: 900, textAlign: "center", marginBottom: 8 }} />
              <div style={{ textAlign: "center", fontSize: 13, color: "#2e7d32", fontWeight: 800, marginBottom: 16 }}>= خصم {val.toLocaleString()} {CUR}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setRedeemOpen(false)} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700 }}>إلغاء</button>
                <button onClick={doRedeem} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "#6a1b9a", color: "#fff", fontWeight: 800 }}>استبدال</button>
              </div>
            </div>
          </div>
        );
      })()}
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
      <button onClick={() => setAddModal(true)}
        style={{ width: "100%", background: "#1565c0", color: "#fff", border: "none", borderRadius: 12, padding: 13, fontWeight: 800, fontSize: 14, cursor: "pointer", marginBottom: 12 }}>
        ＋ إضافة زبون
      </button>
      <input className="input" placeholder="🔍 ابحث عن زبون..." value={search}
        onChange={e => setSearch(e.target.value)} style={{ marginBottom: 14 }} />

      {addModal && (
        <div onClick={() => setAddModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 360 }}>
            <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 14 }}>➕ إضافة زبون جديد</h3>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 4 }}>الاسم *</label>
            <input className="input" value={nc.name} onChange={e => setNc(f => ({ ...f, name: e.target.value }))} style={{ marginBottom: 12 }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 4 }}>الهاتف (اختياري)</label>
            <input className="input" inputMode="tel" value={nc.phone} onChange={e => setNc(f => ({ ...f, phone: e.target.value }))} style={{ marginBottom: 12 }} />
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 4 }}>ملاحظات (اختياري)</label>
            <textarea className="input" value={nc.notes} onChange={e => setNc(f => ({ ...f, notes: e.target.value }))} style={{ height: 56, resize: "none", marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setAddModal(false); setNc({ name: "", phone: "", notes: "" }); }} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700 }}>إلغاء</button>
              <button onClick={saveNewCustomer} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "#1565c0", color: "#fff", fontWeight: 800 }}>حفظ</button>
            </div>
          </div>
        </div>
      )}
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
  const today = useMemo(() => workDayStart(store.shifts), [store.shifts]); // v37
  const [period, setPeriod] = useState("today");
  const [search, setSearch] = useState("");

  const getStart = () => {
    const d = new Date();
    if (period === "today") { return workDayStart(store.shifts); }
    if (period === "week") { return weekStartThursday(); }
    if (period === "month") { d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
    return new Date(0);
  };

  const receipts = (store.receipts || [])
    .filter(r => new Date(r.createdAt) >= getStart())
    .filter(r => !search || (r.orderNum || "").includes(search) || (r.customerName || "").includes(search) || (r.tableNum || "").includes(search))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const totalRevenue = receipts.reduce((s, r) => s + Math.max(0, (r.total || 0) - (r.tronAmount || 0)), 0); // v36: بلا ترون
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
    if(period==="today"){return workDayStart(store.shifts)}
    if(period==="week"){return weekStartThursday()}
    if(period==="month"){d.setDate(1);d.setHours(0,0,0,0);return d}
    return new Date(0);
  };

  const start=getStart();
  // للفترة "الكل" نمرّر null إلى القاعدة كي تشمل الأرشيف كاملاً بلا حدّ سفلي
  const fromArg=period==="all"?null:start;

  const pOrders=store.orders.filter(o=>new Date(o.createdAt)>=start);
  const paidOrders=pOrders.filter(o=>o.status==="paid"&&new Date(o.paidAt||o.createdAt)>=start);

  // ══════════════════════════════════════════════════════════════════
  // v46 — نهاية البتر الصامت في التقارير
  // ──────────────────────────────────────────────────────────────────
  // التطبيق يجلب آخر 500 طلب فقط. كانت هذه الشاشة تحسب كل شيء من
  // store.orders مباشرة، فكافيه يبيع 50 طلباً يومياً يستنفدها في عشرة
  // أيام: تضغط «الشهر» فترى عشرة أيام مكتوباً فوقها «الشهر»، و«الكل»
  // ليس كل شيء. لا خطأ ولا تحذير — الرقم يبدو سليماً وهو ناقص.
  //
  // طبقة aggregates (v43) كُتبت لهذا بالضبط وكانت مربوطة بلوحة التحكم
  // وأداء الموظفين فقط. الآن التقارير عليها أيضاً.
  //
  // القاعدة: **رقم صحيح، أو رقم موسوم بأنه جزئي. لا رقم كاذب.**
  // ══════════════════════════════════════════════════════════════════
  const [agg,setAgg]=useState(null);
  const [expAgg,setExpAgg]=useState(null);

  useEffect(()=>{
    let alive=true;
    Promise.all([
      fetchSalesTotals(store.orders,{from:fromArg}),
      fetchExpenseTotals(store.expenses,{from:fromArg}),
    ]).then(([a,e])=>{ if(alive){ setAgg(a); setExpAgg(e); } }).catch(()=>{});
    return()=>{alive=false;};
  },[period,store.orders,store.expenses]);

  // exact=true ⇒ الرقم من القاعدة ويشمل الأرشيف. false ⇒ من المحمَّل فقط.
  const exact=!!(agg?.exact&&expAgg?.exact);
  const mk=approxMark(exact);

  const revenue    = agg?.revenue    ?? paidOrders.reduce((s,o)=>s+orderSale(o),0);
  const paidCount  = agg?.ordersCount ?? paidOrders.length;
  const debtsTotal = agg?.debtTotal  ?? pOrders.filter(o=>o.status==="debt").reduce((s,o)=>s+o.total,0);
  const tronRevenue= agg?.tronTotal  ?? (store.receipts||[]).filter(r=>r.tronAmount>0&&new Date(r.createdAt)>=start).reduce((s,r)=>s+r.tronAmount,0);
  const expenses   = expAgg?.primary ?? (store.expenses||[]).filter(e=>!e.isSecondary&&!e.isComplimentary&&new Date(e.date)>=start).reduce((s,e)=>s+e.amount,0);
  const netProfit  = revenue-expenses;
  const avgOrder   = paidCount>0?Math.round(revenue/paidCount):0;

  // هذان يُحسبان من الصفوف المحمَّلة حصراً (لا تجميعة لهما في القاعدة)،
  // فيبقيان تقريبيين دائماً ويُوسمان بذلك صراحةً بدل أن يُعرضا كأنهما كاملان.
  const cancelled=pOrders.filter(o=>o.status==="cancelled").length;
  const receiptCount=(store.receipts||[]).filter(r=>new Date(r.createdAt)>=start).length;

  // v29: الاستهلاك الداخلي — منفصل تماماً عن البيع (لا ربح ولا مصروف)
  const compEntries=(store.compLog||[]).filter(c=>new Date(c.date)>=start);
  const custCompTotal=compEntries.filter(c=>c.reason!=="worker").reduce((s,c)=>s+(c.amount||0),0);
  const custCompCount=compEntries.filter(c=>c.reason!=="worker").length;
  const workerCompTotal=compEntries.filter(c=>c.reason==="worker").reduce((s,c)=>s+(c.amount||0),0);
  const workerCompCount=compEntries.filter(c=>c.reason==="worker").length;

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
    ${exact?"":'<p style="color:#e65100;font-weight:700">≈ أرقام تقريبية — محسوبة من الطلبات المحمَّلة فقط، لا من كامل السجل.</p>'}
    <table><tr><th>البند</th><th>القيمة</th></tr>
    <tr><td>إجمالي الإيرادات</td><td class="pos">${mk}${revenue.toLocaleString()} ${CUR}</td></tr>
    <tr><td>إجمالي المصاريف</td><td class="neg">${mk}${expenses.toLocaleString()} ${CUR}</td></tr>
    <tr><td>صافي الربح</td><td class="${netProfit>=0?"pos":"neg"}">${mk}${netProfit.toLocaleString()} ${CUR}</td></tr>
    <tr><td>طلبات مدفوعة</td><td>${mk}${paidCount}</td></tr>
    <tr><td>متوسط قيمة الطلب</td><td>${mk}${avgOrder.toLocaleString()} ${CUR}</td></tr>
    <tr><td>ملغاة</td><td>≈ ${cancelled}</td></tr>
    <tr><td>ديون</td><td>${mk}${debtsTotal.toLocaleString()} ${CUR}</td></tr>
    ${Object.entries(catRevenue).map(([c,r])=>`<tr><td>${CAT_LABELS[c]}</td><td>${r.toLocaleString()} ${CUR}</td></tr>`).join("")}
    </table>
    <h3>🎁 الاستهلاك الداخلي (منفصل عن البيع)</h3>
    <table><tr><th>البند</th><th>القيمة</th><th>عدد السجلات</th></tr>
    <tr><td>ضيافة الزبائن (بسعر البيع)</td><td>${custCompTotal.toLocaleString()} ${CUR}</td><td>${custCompCount}</td></tr>
    <tr><td>مشاريب العمال (بسعر التكلفة)</td><td>${workerCompTotal.toLocaleString()} ${CUR}</td><td>${workerCompCount}</td></tr>
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

      {/* v46: لا رقم مجهول المصدر — نقول للمستخدم من أين جاء الرقم */}
      <div style={{fontSize:11.5,lineHeight:1.7,marginBottom:14,padding:"8px 12px",borderRadius:10,
        background:exact?"rgba(46,125,50,.10)":"rgba(230,81,0,.10)",
        color:exact?"#2e7d32":"#e65100",fontWeight:700}}>
        {agg===null
          ? "⏳ جارٍ حساب الإجماليات..."
          : exact
          ? "✅ الإجماليات محسوبة في القاعدة — تشمل الأرشيف كاملاً"
          : "≈ أرقام تقريبية — محسوبة من الطلبات المحمَّلة (آخر 500) فقط. نفّذ هجرة v43 في Supabase للحصول على الإجمالي الكامل."}
        <div style={{fontWeight:400,marginTop:4,opacity:.85}}>
          «الفواتير» و«الملغاة» وتفصيل الأصناف تُحسب دائماً من المحمَّل فقط.
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:18}}>
        {[["💰","الإيرادات",`${mk}${revenue.toLocaleString()} ${CUR}`,"#c62828"],
          ["📒","المصاريف",`${mk}${expenses.toLocaleString()} ${CUR}`,"#e65100"],
          ["💹","صافي الربح",`${mk}${netProfit.toLocaleString()} ${CUR}`,netProfit>=0?"#2e7d32":"#c62828"],
          ["✅","طلبات مدفوعة",`${mk}${paidCount}`,"#2e7d32"],
          ["📊","متوسط الطلب",`${mk}${avgOrder.toLocaleString()} ${CUR}`,"#1976d2"],
          ["💳","ديون",`${mk}${debtsTotal.toLocaleString()} ${CUR}`,"#6a1b9a"],
          ["💠","الترون",`${mk}${tronRevenue.toLocaleString()} ${CUR}`,"#1565c0"],
          ["🧾","الفواتير","≈ "+receiptCount,"#00897b"],
        ].map(([icon,label,val,color])=>(
          <div key={label} className="card" style={{textAlign:"center",borderTop:`3px solid ${color}`}}>
            <div style={{fontSize:22,marginBottom:4}}>{icon}</div>
            <div style={{fontSize:11,color:"var(--sub)"}}>{label}</div>
            <div style={{fontSize:14,fontWeight:900,color}}>{val}</div>
          </div>
        ))}
      </div>

      {/* v29: الاستهلاك الداخلي — لا يدخل البيع ولا الربح ولا المصروف */}
      <div className="card" style={{marginBottom:16,borderTop:"3px solid #5e35b1"}}>
        <h3 style={{fontSize:14,fontWeight:800,marginBottom:4}}>🎁 الاستهلاك الداخلي</h3>
        <div style={{fontSize:11,color:"var(--sub)",marginBottom:12}}>منفصل عن البيع — لا يُحتسب ربحاً ولا مصروفاً. يُجرد مستقلاً مع التقرير الشهري.</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div style={{textAlign:"center",padding:"10px",background:"var(--card2)",borderRadius:10}}>
            <div style={{fontSize:12,color:"var(--sub)"}}>👤 ضيافة الزبائن</div>
            <div style={{fontSize:17,fontWeight:900,color:"#00897b"}}>{custCompTotal.toLocaleString()} {CUR}</div>
            <div style={{fontSize:10,color:"var(--sub)"}}>{custCompCount} سجل • بسعر البيع</div>
          </div>
          <div style={{textAlign:"center",padding:"10px",background:"var(--card2)",borderRadius:10}}>
            <div style={{fontSize:12,color:"var(--sub)"}}>☕ مشاريب العمال</div>
            <div style={{fontSize:17,fontWeight:900,color:"#5e35b1"}}>{workerCompTotal.toLocaleString()} {CUR}</div>
            <div style={{fontSize:10,color:"var(--sub)"}}>{workerCompCount} سجل • بسعر التكلفة</div>
          </div>
        </div>
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

      {/* 9. v27: مصفوفة ربحية الأصناف (Menu Engineering Matrix) */}
      {(() => {
        const items=(store.menu||[]).filter(m=>!m.noStock && (m.totalSold||0)>0);
        if(!items.length) return (
          <div className="card" style={{marginBottom:16}}>
            <h3 style={{fontSize:14,fontWeight:800,marginBottom:8}}>📊 مصفوفة ربحية الأصناف</h3>
            <div style={{fontSize:12,color:"var(--sub)",lineHeight:1.7}}>
              لا توجد بيانات بعد. أدخل <b>تكلفة</b> كل صنف من «تعديل المنيو»، وبعد أيام من المبيعات ستظهر هنا
              مصفوفة تصنّف أصنافك (نجوم / أحصنة / ألغاز / خاسرة) لتعرف ماذا تروّج وماذا تحذف.
            </div>
          </div>
        );
        // الربح لكل صنف = (سعر − تكلفة) × المبيع ؛ والهامش %
        const enriched=items.map(m=>{
          const margin=m.price>0?((m.price-(m.cost||0))/m.price)*100:0;
          const unitProfit=m.price-(m.cost||0);
          return {...m, margin, unitProfit, totalProfit:unitProfit*(m.totalSold||0)};
        });
        const avgSold=enriched.reduce((s,m)=>s+(m.totalSold||0),0)/enriched.length;
        const avgMargin=enriched.reduce((s,m)=>s+m.margin,0)/enriched.length;
        const classify=(m)=>{
          const hi=m.totalSold>=avgSold, good=m.margin>=avgMargin;
          if(hi&&good) return {key:"star",label:"⭐ نجم",color:"#2e7d32",hint:"روّج له — مبيع وربح عاليان"};
          if(hi&&!good) return {key:"horse",label:"🐴 حصان",color:"#1565c0",hint:"مبيع عالٍ ربح قليل — ارفع السعر/قلّل التكلفة"};
          if(!hi&&good) return {key:"puzzle",label:"🧩 لغز",color:"#f9a825",hint:"ربح عالٍ مبيع قليل — روّج وأبرزه"};
          return {key:"dog",label:"🐌 خاسر",color:"#c62828",hint:"مبيع وربح ضعيفان — فكّر بحذفه"};
        };
        const noCost=enriched.filter(m=>!m.cost).length;
        const sorted=enriched.slice().sort((a,b)=>b.totalProfit-a.totalProfit);
        return (
          <div className="card" style={{marginBottom:16}}>
            <h3 style={{fontSize:14,fontWeight:800,marginBottom:4}}>📊 مصفوفة ربحية الأصناف</h3>
            <div style={{fontSize:11,color:"var(--sub)",marginBottom:12}}>
              التصنيف مقارنةً بمتوسط مقهاك (مبيع {Math.round(avgSold)} • هامش {Math.round(avgMargin)}%).
              {noCost>0 && <span style={{color:"#f9a825"}}> ⚠ {noCost} صنف بلا تكلفة — أدخلها لدقة أعلى.</span>}
            </div>
            <div style={{overflowX:"auto"}} className="scroll-hide">
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5,minWidth:420}}>
                <thead>
                  <tr style={{color:"var(--sub)",fontSize:11,textAlign:"right"}}>
                    <th style={{padding:"6px 8px"}}>الصنف</th>
                    <th style={{padding:"6px 8px"}}>التصنيف</th>
                    <th style={{padding:"6px 8px"}}>مبيع</th>
                    <th style={{padding:"6px 8px"}}>هامش</th>
                    <th style={{padding:"6px 8px"}}>ربح كلي</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(m=>{
                    const c=classify(m);
                    return (
                      <tr key={m.id} style={{borderTop:"1px solid var(--border)"}}>
                        <td style={{padding:"7px 8px",fontWeight:700}}>{m.emoji||"🍽"} {m.name}</td>
                        <td style={{padding:"7px 8px"}}><span style={{color:c.color,fontWeight:800,fontSize:11.5}}>{c.label}</span></td>
                        <td style={{padding:"7px 8px"}}>{m.totalSold||0}</td>
                        <td style={{padding:"7px 8px",color:m.margin>=avgMargin?"#2e7d32":"#c62828",fontWeight:700}}>{Math.round(m.margin)}%</td>
                        <td style={{padding:"7px 8px",fontWeight:800}}>{Math.round(m.totalProfit).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{marginTop:12,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8}}>
              {[["star","⭐ نجوم","#2e7d32"],["horse","🐴 أحصنة","#1565c0"],["puzzle","🧩 ألغاز","#f9a825"],["dog","🐌 خاسرة","#c62828"]].map(([k,lbl,col])=>{
                const list=enriched.filter(m=>classify(m).key===k);
                return (
                  <div key={k} style={{background:"var(--card2)",borderRadius:10,padding:"8px 10px",borderInlineStart:`3px solid ${col}`}}>
                    <div style={{fontSize:12,fontWeight:800,color:col}}>{lbl} ({list.length})</div>
                    <div style={{fontSize:10.5,color:"var(--sub)",marginTop:2}}>{classify(list[0]||{totalSold:0,margin:0}).hint}</div>
                  </div>
                );
              })}
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

// ══════════════════════════════════════════════════════════════
// v27: إعدادات وجهات تليجرام — متعددة، لكل وجهة أحداث مختارة
// تُحفظ ضمن settings.telegramTargets
// ══════════════════════════════════════════════════════════════
function TelegramSettings({ settings, setForm, showToast }) {
  const targets = settings.telegramTargets || [];
  const [testing, setTesting] = useState(null);

  const update = (arr) => setForm({ ...settings, telegramTargets: arr });

  const addTarget = () => {
    const t = {
      id: "tg_" + Date.now(),
      name: "وجهة جديدة",
      token: "",
      chatId: "",
      events: { shift: true, daily: true, weekly: true, cancel: true, comp: true, debt: false, reset: true },
    };
    update([...targets, t]);
  };
  const patch = (id, key, val) => update(targets.map(t => t.id === id ? { ...t, [key]: val } : t));
  const patchEvent = (id, ev, val) => update(targets.map(t => t.id === id ? { ...t, events: { ...t.events, [ev]: val } } : t));
  const remove = (id) => update(targets.filter(t => t.id !== id));

  const test = async (t) => {
    if (!t.token || !t.chatId) { showToast("أدخل التوكن ومعرّف المحادثة أولاً", "error"); return; }
    setTesting(t.id);
    const r = await testTelegramTarget(t.token, t.chatId);
    setTesting(null);
    if (r.ok) { showToast("✅ وصلت رسالة الاختبار بنجاح", "success"); return; }
    // ترجمة أشهر أخطاء تليجرام لرسائل واضحة
    let msg = r.error || "فشل غير معروف";
    if (/chat not found/i.test(msg)) msg = "المجموعة غير موجودة — تأكد أن البوت عضو فيها وأن المعرّف صحيح (يبدأ بـ -100 للمجموعات الكبيرة)";
    else if (/unauthorized/i.test(msg)) msg = "التوكن غير صحيح — انسخه من جديد من @BotFather";
    else if (/bot.*kicked|not a member|not enough rights/i.test(msg)) msg = "البوت ليس عضواً في المجموعة أو لا يملك صلاحية الإرسال";
    else if (/parse/i.test(msg)) msg = "خطأ في تنسيق الرسالة";
    showToast("⚠ " + msg, "error");
  };

  return (
    <div style={{ marginTop: 24, borderTop: "2px solid var(--border)", paddingTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>📨 تنبيهات تليجرام</h3>
        <button onClick={addTarget} style={{ background: "#0088cc", color: "#fff", border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          ➕ إضافة وجهة
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--sub)", marginBottom: 14, lineHeight: 1.6 }}>
        ربط مجموعات أو حسابات تليجرام لاستقبال تنبيهات تلقائية. لكل وجهة اختر أي أحداث تصلها.
      </p>

      {targets.length === 0 && (
        <div style={{ textAlign: "center", padding: 20, color: "var(--sub)", fontSize: 13, background: "var(--card2)", borderRadius: 12 }}>
          لا توجد وجهات بعد. اضغط «➕ إضافة وجهة» لربط مجموعة تليجرام.
        </div>
      )}

      {targets.map(t => (
        <div key={t.id} style={{ background: "var(--card2)", borderRadius: 14, padding: 14, marginBottom: 12, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input value={t.name} onChange={e => patch(t.id, "name", e.target.value)}
              placeholder="اسم الوجهة (مثلاً: مجموعة الإدارة)"
              style={{ flex: 1, padding: "9px 12px", fontSize: 14, fontWeight: 700, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)", fontFamily: "inherit", outline: "none" }} />
            <button onClick={() => remove(t.id)} style={{ background: "rgba(198,40,40,.15)", color: "#c62828", border: "none", borderRadius: 8, padding: "8px 11px", cursor: "pointer", fontSize: 14 }}>🗑</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 3 }}>توكن البوت (Bot Token)</label>
              <input value={t.token} onChange={e => patch(t.id, "token", e.target.value.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00A0]/g, "").trim())}
                placeholder="123456:ABC..." type="password"
                style={{ width: "100%", padding: "8px 10px", fontSize: 12, borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)", fontFamily: "monospace", outline: "none" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 3 }}>معرّف المحادثة (Chat ID)</label>
              <input value={t.chatId} onChange={e => patch(t.id, "chatId", e.target.value.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00A0]/g, "").trim())}
                placeholder="-100123... للمجموعة"
                style={{ width: "100%", padding: "8px 10px", fontSize: 12, borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)", fontFamily: "monospace", outline: "none" }} />
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sub)", marginBottom: 6 }}>الأحداث المُرسَلة لهذه الوجهة:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {Object.entries(TELEGRAM_EVENTS).map(([key, label]) => {
              const on = !!(t.events && t.events[key]);
              return (
                <button key={key} onClick={() => patchEvent(t.id, key, !on)}
                  style={{ border: "1.5px solid " + (on ? "#0088cc" : "var(--border)"), borderRadius: 16, padding: "5px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: on ? "#0088cc" : "transparent", color: on ? "#fff" : "var(--text)" }}>
                  {on ? "✓ " : ""}{label}
                </button>
              );
            })}
          </div>

          <button onClick={() => test(t)} disabled={testing === t.id}
            style={{ background: "rgba(0,136,204,.15)", color: "#0088cc", border: "1px solid rgba(0,136,204,.3)", borderRadius: 9, padding: "8px 14px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
            {testing === t.id ? "⏳ جارٍ الاختبار..." : "🧪 اختبار الإرسال"}
          </button>
        </div>
      ))}
    </div>
  );
}

export function SettingsTab({store,showToast,dm,user}){
  const isAdmin=user?.role==="admin";
  const { trigger: rawDangerConfirm, modal: dangerModal } = useDangerConfirm();

  // ══════════════════════════════════════════════════════════════════
  // v46 — التصفير يتطلّب نسخة احتياطية حديثة
  // ──────────────────────────────────────────────────────────────────
  // ثلاثة عشر زرّ تصفير هنا تمحو نهائياً بلا رجعة، وحارسها نافذة تأكيد
  // واحدة. هذه هي الكارثة الوحيدة في المشروع التي لا تُصلَح: السرقة
  // تأخذ جزءاً، وفقدان البيانات يأخذ التاريخ كله.
  //
  // القفل: لا تصفير ما لم توجد نسخة (تليجرام أو تنزيل يدوي) أحدث من
  // سبعة أيام. لا يمنع التصفير — يمنع التصفير *الأعمى*.
  // ══════════════════════════════════════════════════════════════════
  const dangerConfirm = guardedReset(rawDangerConfirm, showToast);

  const notifyReset=(what)=>notifyTelegram(store.settings?.telegramTargets||[], "reset", buildEventMsg("reset", { details: "تم تصفير: "+what, by: user?.name||"الأدمن" }, store.settings?.cafeName||"ناردين كافيه", store.settings?.currency||"ل.س"));
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
    settings:"الإعدادات",activity:"سجل النشاط",replay:"إعادة تشغيل الوردية",
  };

  return(
    <div className="fade-in">
      <h2 style={{fontSize:18,fontWeight:900,marginBottom:20}}>⚙ الإعدادات</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:20}}>

        {/* النسخ الاحتياطي */}
        <div className="card">
          <h3 style={{fontSize:15,fontWeight:800,marginBottom:12,color:"#c62828"}}>💾 النسخ الاحتياطي</h3>
          <div style={{fontSize:12,color:"var(--sub)",lineHeight:1.7,marginBottom:12}}>
            احفظ نسخة كاملة من بياناتك كملف. بياناتك محفوظة سحابيًا أيضًا. (يعمل التنزيل بأفضل صورة من المتصفّح/الـPWA.)
          </div>
          <button onClick={()=>{
            try{
              const data={ _meta:{app:"nardeen-caffe",exportedAt:new Date().toISOString()},
                orders:store.orders||[], menu:store.menu||[], tables:store.tables||[],
                outdoorTables:store.outdoorTables||[], debts:store.debts||[], expenses:store.expenses||[],
                customers:store.customers||[], receipts:store.receipts||[], settings:store.settings||{} };
              const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
              const u=URL.createObjectURL(blob); const a=document.createElement("a");
              a.href=u; a.download=`nardeen-backup-${new Date().toISOString().slice(0,10)}.json`;
              document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),1000);
              try{localStorage.setItem("nc_last_backup",new Date().toISOString());}catch{}
              showToast?.("تم تنزيل النسخة الاحتياطية ✓");
            }catch{ showToast?.("تعذّر التصدير","error"); }
          }} className="btn btn-red" style={{width:"100%"}}>تنزيل نسخة احتياطية كاملة (JSON)</button>
          <div style={{fontSize:11,color:"var(--sub)",marginTop:8}}>
            آخر نسخة: {(()=>{try{const t=localStorage.getItem("nc_last_backup");return t?new Date(t).toLocaleString("ar"):"—";}catch{return "—";}})()}
          </div>

          {/* v45: نسخة إلى تليجرام — التنزيل اليدوي يعتمد على أن تتذكّره.
              الإرسال التلقائي الأسبوعي لا يعتمد على ذاكرة أحد. */}
          <div style={{borderTop:"1px dashed var(--border)",marginTop:14,paddingTop:12}}>
            <button onClick={async()=>{
              const targets=store.settings?.telegramTargets||[];
              if(!targets.some(t=>t?.events?.backup)){ showToast?.("فعّل حدث «نسخة احتياطية» في إحدى وجهات تليجرام أولاً","error"); return; }
              showToast?.("جارٍ الإرسال...");
              const {sent}=await sendBackupNow(store,targets);
              showToast?.(sent>0?`✓ أُرسلت النسخة إلى ${sent} وجهة`:"تعذّر الإرسال — راجع التوكن",sent>0?"success":"error");
            }} className="btn btn-ghost" style={{width:"100%"}}>🗄 إرسال نسخة إلى تليجرام الآن</button>
            <div style={{fontSize:11,color:"var(--sub)",marginTop:8,lineHeight:1.7}}>
              تُرسَل تلقائياً كل أسبوع من جهاز الأدمن عند تفعيل حدث «نسخة احتياطية».
              <br/>آخر إرسال: {(()=>{const t=lastBackupAt();return t?new Date(t).toLocaleString("ar"):"—";})()}
            </div>
          </div>

          <RestoreBackup store={store} showToast={showToast} user={user}/>
        </div>

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
            <div>
              <div style={{fontSize:12,color:"var(--sub)",marginBottom:12}}>
                ✏ اضغط على دور لتفعيل صلاحيته في القسم أو إلغائها — الأدمن دائماً لديه صلاحية كاملة
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
                {Object.keys(sectionLabels).filter(s=>!["customer_home","myorders"].includes(s)).map(section=>(
                  <div key={section} style={{background:"var(--card2)",borderRadius:12,padding:"12px 14px"}}>
                    <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>{sectionLabels[section]||section}</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {Object.entries(ROLE_LABELS).filter(([v])=>v!==ROLES.CUSTOMER&&v!==ROLES.ADMIN).map(([role,label])=>{
                        const hasPerm=(dynPerms[section]||[]).includes(role);
                        return(
                          <button key={role} onClick={()=>togglePerm(section,role)}
                            style={{whiteSpace:"nowrap",padding:"7px 12px",borderRadius:20,cursor:"pointer",fontSize:12,fontWeight:700,
                              border:hasPerm?"none":`1.5px solid var(--border)`,
                              background:hasPerm?(ROLE_COLORS[role]||"#2e7d32"):"transparent",
                              color:hasPerm?"#fff":"var(--sub)",transition:"all .15s"}}>
                            {hasPerm?"✓ ":""}{label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Danger Zone */}
        {isAdmin&&(
          <div className="card" style={{gridColumn:"1/-1",borderTop:"4px solid #c62828"}}>
            <h3 style={{fontSize:15,fontWeight:800,marginBottom:14,color:"#c62828"}}>⚠️ منطقة الأدمن — تصفير</h3>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button onClick={async()=>{dangerConfirm("تصفير جميع الطلبات والمبيعات",async()=>{store.setOrders([]);store.setCashLog([]);if(SUPABASE_READY){await sbDeleteAll("orders");await sbDeleteAll("cash_log");}logActivity({action:"تصفير بيانات",details:"الطلبات + سجل النقد",userName:user?.name||"",userRole:"admin"});notifyReset("الطلبات + سجل النقد");showToast("تم تصفير المبيعات","warn");})}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#c62828",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير المبيعات
              </button>
              <button onClick={async()=>{dangerConfirm("تصفير الديون",async()=>{store.setDebts([]);if(SUPABASE_READY){await sbDeleteAll("debts");}logActivity({action:"تصفير بيانات",details:"الديون",userName:user?.name||"",userRole:"admin"});notifyReset("الديون");showToast("تم","warn");})}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#6a1b9a",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير الديون
              </button>
              <button onClick={async()=>{dangerConfirm("تصفير المصاريف",async()=>{store.setExpenses([]);if(SUPABASE_READY){await sbDeleteAll("expenses");}logActivity({action:"تصفير بيانات",details:"المصاريف",userName:user?.name||"",userRole:"admin"});notifyReset("المصاريف");showToast("تم","warn");})}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#e65100",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير المصاريف
              </button>
              <button onClick={async()=>{dangerConfirm("تصفير سجل الضيافة",async()=>{store.setCompLog([]);if(SUPABASE_READY){await sbDeleteAll("comp_log");}logActivity({action:"تصفير بيانات",details:"سجل الضيافة",userName:user?.name||"",userRole:"admin"});notifyReset("سجل الضيافة");showToast("تم","warn");})}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#00897b",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير الضيافة
              </button>
              <button onClick={async()=>{dangerConfirm("تصفير بيانات الزبائن",async()=>{store.setCustomers([]);if(SUPABASE_READY){await sbDeleteAll("customers");}logActivity({action:"تصفير بيانات",details:"الزبائن",userName:user?.name||"",userRole:"admin"});notifyReset("الزبائن");showToast("تم","warn");})}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#1565c0",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير الزبائن
              </button>
              <button onClick={async()=>{dangerConfirm("تصفير سجل الفواتير",async()=>{store.setReceipts([]);if(SUPABASE_READY){await sbDeleteAll("receipts");}logActivity({action:"تصفير بيانات",details:"الفواتير",userName:user?.name||"",userRole:"admin"});notifyReset("الفواتير");showToast("تم تصفير الفواتير","warn");})}}
                style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#37474f",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🗑️ تصفير الفواتير
              </button>
              <button onClick={()=>dangerConfirm("إعادة تعيين الإعدادات للافتراضية",async()=>{
                logActivity({action:"تصفير بيانات",details:"الإعدادات",userName:user?.name||"",userRole:"admin"});notifyReset("الإعدادات");
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
              })} style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#004d40",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🔄 تصفير الإعدادات
              </button>
              <button onClick={()=>dangerConfirm("إعادة ضبط الطاولات (حذف وتوليد 20 نظيفة)",async()=>{
                try{
                  const n=await store.resetTables("main",20);
                  logActivity({action:"تصفير بيانات",details:`إعادة ضبط الطاولات (${n})`,userName:user?.name||"",userRole:"admin"});
                  showToast(`✅ أُعيد توليد ${n} طاولة نظيفة`,"warn");
                }catch(e){ showToast("⚠ "+(e?.message||"فشل إعادة الضبط"),"error"); }
              })} style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#4a148c",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🪑 إعادة ضبط الطاولات
              </button>
              <button onClick={()=>dangerConfirm("إعادة ضبط طاولات الحديقة (حذف وتوليد 10 نظيفة)",async()=>{
                try{
                  const n=await store.resetTables("outdoor",10);
                  logActivity({action:"تصفير بيانات",details:`إعادة ضبط طاولات الحديقة (${n})`,userName:user?.name||"",userRole:"admin",branch:"outdoor"});
                  showToast(`✅ أُعيد توليد ${n} طاولة حديقة نظيفة`,"warn");
                }catch(e){ showToast("⚠ "+(e?.message||"فشل إعادة الضبط"),"error"); }
              })} style={{flex:1,padding:12,borderRadius:12,border:"none",background:"#1b5e20",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",minWidth:130}}>
                🌳 إعادة ضبط طاولات الحديقة
              </button>
            </div>
          </div>
        )}
      </div>

      <TelegramSettings settings={form} setForm={setForm} showToast={showToast} />

      <div style={{marginTop:24,display:"flex",justifyContent:"flex-end"}}>
        <button className="btn btn-red" onClick={save} style={{padding:"12px 32px",fontSize:15}}>
          💾 حفظ الإعدادات
        </button>
      </div>
      {dangerModal}
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════
// OUTDOOR ADMIN TAB — لوحة إدارة الحديقة للأدمن
// ═══════════════════════════════════════════════════════════════

export function OutdoorAdminTab({ store, showToast, dm, settings, user }) {
  const { trigger: rawDangerConfirm, modal: dangerModal } = useDangerConfirm();
  const dangerConfirm = guardedReset(rawDangerConfirm, showToast);   // v46
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

  const today = workDayStart(store.shifts); // v37
  const todayRevenue = outdoorCash
    .filter(e => e.type === "sale" && new Date(e.at) >= today)
    .reduce((s, e) => s + (e.amount || 0), 0);

  // ── تصفير الحديقة ──────────────────────────────────────────
  const resetOutdoorOrders = () => dangerConfirm("تصفير جميع طلبات الحديقة", async () => {
    logActivity({action:"تصفير بيانات",details:"طلبات الحديقة",userName:user?.name||"",userRole:"admin",branch:"outdoor"});
    store.setOrders(p => p.filter(o => o.branch !== "outdoor"));
    store.setCashLog(p => p.filter(e => e.branch !== "outdoor"));
    if (SUPABASE_READY) {
      // حذف الطلبات والكاش الخاصة بالحديقة فقط
      const ids = outdoorOrders.map(o => o.id);
      for (const id of ids) { try { await sbDelete("orders", id); } catch {} }
    }
    showToast("تم تصفير مبيعات الحديقة", "warn");
  });

  const resetOutdoorReceipts = () => dangerConfirm("تصفير فواتير الحديقة", async () => {
    logActivity({action:"تصفير بيانات",details:"فواتير الحديقة",userName:user?.name||"",userRole:"admin",branch:"outdoor"});
    store.setReceipts(p => p.filter(r => r.branch !== "outdoor"));
    const ids = outdoorReceipts.map(r => r.id);
    if (SUPABASE_READY) { for (const id of ids) { try { await sbDelete("receipts", id); } catch {} } }
    showToast("تم تصفير فواتير الحديقة", "warn");
  });

  const resetOutdoorCash = () => dangerConfirm("تصفير كاش الحديقة", async () => {
    logActivity({action:"تصفير بيانات",details:"كاش الحديقة",userName:user?.name||"",userRole:"admin",branch:"outdoor"});
    const cashIds = outdoorCash.map(e => e.id);
    store.setCashLog(p => p.filter(e => e.branch !== "outdoor"));
    if (SUPABASE_READY) { for (const id of cashIds) { try { await sbDelete("cash_log", id); } catch {} } }
    showToast("تم تصفير كاش الحديقة", "warn");
  });

  const resetOutdoorTables = () => {
    if (!window.confirm("تحرير جميع طاولات الحديقة؟")) return;
    store.setOutdoorTables(p => p.map(t => ({ ...t, status: "free", orderId: null, openedAt: null })));
    showToast("تم تحرير جميع طاولات الحديقة", "warn");
  };

  const resetAllOutdoor = () => dangerConfirm("تصفير كل بيانات الحديقة (طلبات + كاش + فواتير)", async () => {
    logActivity({action:"تصفير بيانات",details:"كل بيانات الحديقة",userName:user?.name||"",userRole:"admin",branch:"outdoor"});
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
  });

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
                        if (!window.confirm(`تحرير ${t.label} بدون دفع؟ سيُلغى الطلب المعلّق`)) return;
                        if (tOrder && tOrder.status === "pending") {
                          restoreOrderStock(store, tOrder); // v23: يُرجع فقط إن كان قد خُصم
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
    {dangerModal}
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════
// v28: شاشة «جرد واستيراد المخزون» — تعمل على المنيو الحيّ مباشرة
//  • إدخال جرد شهري + تكلفة + سعر لكل صنف
//  • قاعدة التسعير: السعر = أعلى من (السعر الحالي) و(التكلفة×1.2 مقرّبة لأقرب 10)  ← رفع فقط
//  • مفتاح مرن لكل صنف: مفتوح (لا خصم) ↔ حقيقي (يُخصم ويُنبّه)
//  • إضافة الأصناف الجديدة المتّفق عليها إن لم تكن موجودة
//  • عدّاد فحم مساعد (أراكيل الشهر ÷ 6) — بلا خصم آلي
// ══════════════════════════════════════════════════════════════════

// تطبيع عربي للمطابقة بالاسم (للبوظة والأصناف الجديدة)
const _norm = (s) => (s||"").toString()
  .replace(/[ًٌٍَُِّْـ]/g,"").replace(/[أإآا]/g,"ا")
  .replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/\s+/g,"").trim();

// قاعدة السعر: تقريب لأقرب 10، ورفع فقط (لا يخفض سعراً هامشه أعلى من 20%)
const _round10 = (n) => Math.round((+n||0)/10)*10;
const _target  = (cost) => _round10((+cost||0)*1.2);

// الأصناف الجديدة المتّفق على إضافتها (إن غابت بالاسم)
const NEW_ITEMS = [
  { key:"slush",  name:"سلس برتقال",        nameEn:"Slush",        category:"cold_drinks", cost:105, stock:8,  emoji:"🥤" },
  { key:"jack",   name:"جاك (طاقة)",        nameEn:"Jack Energy",  category:"cold_drinks", cost:115, stock:29, emoji:"⚡" },
  { key:"bison",  name:"بايسون (طاقة)",     nameEn:"Bison Energy", category:"cold_drinks", cost:115, stock:16, emoji:"⚡" },
  { key:"hkvar",  name:"أركيلة طعمات متنوعة", nameEn:"Assorted Hookah", category:"hookah",  cost:125, stock:5,  emoji:"💨" },
];

export function StockImportTab({ store, user, showToast, settings }){
  const CUR = settings?.currency || "ل.س";
  const menu = store.menu || [];

  // بناء صفوف الإدخال من المنيو الحيّ مع تعبئة الخطة المقترحة
  // v30.2: الشاشة مرآة للبيانات الحيّة فقط — لا خطة مكتوبة تتعارض مع الواقع
  const buildRows = (src = menu) => src
    .filter(m => !m.noStock) // الأصناف الخدمية svc لا تُجرد
    .map(m => ({
      id:m.id, name:m.name, emoji:m.emoji||"", category:m.category,
      cost:String(m.cost ?? 0),
      stock:String(Math.round(+m.stock||0)),
      track: m.trackStock !== false,
      origStock: Math.round(+m.stock||0),
      origCost:  Math.round(+m.cost||0),
      origTrack: m.trackStock !== false,
    }));

  const [rows, setRows] = useState(buildRows);
  const [onlyTracked, setOnlyTracked] = useState(false);
  const [newSel, setNewSel] = useState(() => Object.fromEntries(NEW_ITEMS.map(n=>[n.key,true])));
  const built = useRef(rows.length>0);

  // إعادة التعبئة إن وصل المنيو متأخراً (تحميل غير متزامن)
  useEffect(()=>{ if(!built.current && menu.length){ setRows(buildRows()); built.current=true; } },[menu.length]);

  const upd = (id, field, val) => setRows(p => p.map(r => r.id===id ? {...r,[field]:val} : r));

  // أيّ أصناف جديدة غائبة فعلاً (بالاسم المطبّع)
  const liveNames = new Set(menu.map(m=>_norm(m.name)));
  const missingNew = NEW_ITEMS.filter(n => !liveNames.has(_norm(n.name)));

  // ── v40: عدّاد استهلاك الأراكيل (فحم + معسل) ──────────────────
  // المعدّلات المعتمدة من الإدارة:
  const HK_HEADS_PER_KG   = 7;  // 7 رؤوس = 1 كغ فحم
  const HK_HEADS_PER_PACK = 26; // تفاحتين: 26 رأساً = كف واحد
  const HK_HEADS_PER_TIN  = 5;  // باقي النكهات: 5 رؤوس = علبة واحدة
  const [hkPeriod,setHkPeriod]=useState("month"); // يوم العمل / أسبوع / شهر

  const charcoal = useMemo(()=>{
    const d=new Date();
    const start = hkPeriod==="today" ? workDayStart(store.shifts)
                : hkPeriod==="week"  ? weekStartThursday()
                : new Date(d.getFullYear(), d.getMonth(), 1);

    const hkItems=menu.filter(m=>m.category==="hookah");
    const hkMap=new Map(hkItems.map(m=>[m.id,m]));
    const isDoubleApple=(m)=>_norm(m?.name).includes(_norm("تفاحتين"));

    let heads=0, daHeads=0, otherHeads=0;
    const byItem={}; // اسم الصنف -> عدد الرؤوس

    (store.orders||[]).forEach(o=>{
      // يشمل: مدفوع + دين + ضيافة — كلها تستهلك فحماً ومعسلاً فعلياً
      if(!["paid","debt","complimentary"].includes(o.status)) return;
      if(new Date(o.paidAt||o.createdAt) < start) return;
      (o.items||[]).forEach(it=>{
        const m=hkMap.get(it.itemId); if(!m) return;
        const q=+it.qty||0; if(q<=0) return;
        heads+=q;
        if(isDoubleApple(m)) daHeads+=q; else otherHeads+=q;
        byItem[m.name]=(byItem[m.name]||0)+q;
      });
    });

    const r1=(n)=>Math.round(n*10)/10;
    return {
      heads, daHeads, otherHeads,
      kg:        r1(heads/HK_HEADS_PER_KG),          // فحم (كغ)
      daPacks:   r1(daHeads/HK_HEADS_PER_PACK),      // تفاحتين (كف)
      otherTins: r1(otherHeads/HK_HEADS_PER_TIN),    // باقي النكهات (علبة)
      breakdown: Object.entries(byItem).sort((a,b)=>b[1]-a[1]),
    };
  },[menu, store.orders, store.shifts, hkPeriod]);

  const changedCount = rows.filter(r =>
    Math.round(+r.stock)!==r.origStock ||
    Math.round(+r.cost)!==r.origCost || r.track!==r.origTrack
  ).length;

  const save = () => {
    // فروقات المخزون = نيّتك (المُدخَل − ما رأيته)، تُطبَّق على الرصيد الحيّ لحظة الحفظ
    const stockIntent = {};   // id -> فرق نسبي (للأصناف المتعقّبة التي بقيت متعقّبة)
    const stockAbsolute = {}; // id -> قيمة مطلقة (لصنف صار متعقّباً الآن)
    const costBy = {}; const trackBy = {};
    const auditLines = [];
    rows.forEach(r => {
      const enteredStock = Math.round(+r.stock||0);
      const enteredCost  = Math.round(+r.cost||0);
      if (r.track !== r.origTrack) { trackBy[r.id] = r.track; }
      if (enteredCost !== r.origCost) { costBy[r.id] = enteredCost; }
      if (r.track && !r.origTrack) {
        stockAbsolute[r.id] = enteredStock; // صار متعقّباً الآن → القيمة المُدخَلة مطلقة
        auditLines.push(`${r.name}: تتبّع + رصيد ${enteredStock}`);
      } else if (r.track && enteredStock !== r.origStock) {
        stockIntent[r.id] = enteredStock - r.origStock; // فرق نسبي
        auditLines.push(`${r.name}: ${enteredStock - r.origStock > 0 ? "+" : ""}${enteredStock - r.origStock}`);
      }
    });
    const toAdd = missingNew.filter(n=>newSel[n.key]).map(n=>({
      id:"m"+Date.now()+"_"+n.key, name:n.name, nameEn:n.nameEn,
      price:_target(n.cost), category:n.category, stock:n.stock, minStock:5,
      cost:n.cost, totalSold:0, emoji:n.emoji, active:true, trackStock:true,
    }));

    const nChanges = Object.keys({...stockIntent,...stockAbsolute,...costBy,...trackBy}).length;
    if (!nChanges && !toAdd.length) { showToast("لا توجد تعديلات للحفظ","info"); return; }

    // قراءة-ثم-كتابة ذرّية: نقرأ الرصيد الحيّ داخل المُحدِّث لحظة التطبيق
    store.setMenu(prev => {
      const next = prev.map(m => {
        let out = m;
        if (m.id in trackBy) out = { ...out, trackStock: trackBy[m.id] };
        if (m.id in costBy)  out = { ...out, cost: costBy[m.id] };
        if (m.id in stockAbsolute) out = { ...out, stock: Math.max(0, stockAbsolute[m.id]) };
        else if (m.id in stockIntent) out = { ...out, stock: Math.max(0, (out.stock||0) + stockIntent[m.id]) }; // الفرق على الحيّ
        return out;
      });
      return [...next, ...toAdd];
    });

    auditLines.forEach(line=>{ try{ logActivity({action:"جرد مخزون",details:line,userName:user?.name||"أدمن",userRole:user?.role||"admin",branch:"main"}); }catch{} });
    if (toAdd.length) { try{ logActivity({action:"إضافة أصناف (جرد)",details:toAdd.map(a=>a.name).join("، "),userName:user?.name||"أدمن",userRole:user?.role||"admin",branch:"main"}); }catch{} }
    // v31.2: سطر «فاقد الجرد» — مجموع النقص (الفروقات السالبة) × التكلفة، سطر واحد في التدقيق
    const shrinkage = rows.reduce((s, r) => {
      if (!r.track) return s;
      const diff = Math.round(+r.stock||0) - r.origStock;
      return diff < 0 ? s + (Math.abs(diff) * (Math.round(+r.cost||0))) : s;
    }, 0);
    if (shrinkage > 0) { try{ logActivity({action:"فاقد الجرد",details:`خسارة جرد ${shrinkage.toLocaleString()} ل.س (نقص غير مسجّل)`,userName:user?.name||"أدمن",userRole:user?.role||"admin",amount:shrinkage,branch:"main"}); }catch{} }
    showToast(`✅ حُفظ الجرد — ${nChanges} تعديل${toAdd.length?` + ${toAdd.length} صنف جديد`:""}${shrinkage>0?` • فاقد ${shrinkage.toLocaleString()}`:""}`,"success");
    built.current=false; setRows([]); // إعادة المرآة من البيانات الحيّة المحدّثة
  };

  const catLabel = { hot_drinks:"☕ ساخنة", cold_drinks:"🧊 باردة", food:"🍔 طعام", hookah:"💨 أراكيل", services:"🎟️ خدمات" };
  const order = ["hot_drinks","cold_drinks","hookah","food","services"];
  const shown = onlyTracked ? rows.filter(r=>r.track) : rows;
  const grouped = order.map(c=>[c, shown.filter(r=>r.category===c)]).filter(([,a])=>a.length);

  const ipt = {width:58,padding:"5px 6px",borderRadius:8,border:"1px solid var(--border)",
    background:"var(--card2)",color:"var(--text)",fontSize:13,fontWeight:700,textAlign:"center"};
  const lbl = {fontSize:9,color:"var(--sub)",display:"block",marginBottom:2,textAlign:"center"};

  return (
    <div className="fade-in">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:8}}>
        <h2 style={{fontSize:18,fontWeight:900}}>📦 جرد واستيراد المخزون</h2>
        <span style={{fontSize:11,color:"var(--sub)"}}>يُعدّل المنيو الحيّ مباشرة</span>
      </div>

      {/* شريط أدوات */}
      <div className="card" style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",marginBottom:12}}>
        <button onClick={()=>setOnlyTracked(s=>!s)} style={{padding:"8px 14px",borderRadius:10,
          border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text)",fontWeight:700,fontSize:13,cursor:"pointer"}}>
          {onlyTracked?"عرض الكل":"المتعقّبة فقط"}
        </button>
        <span style={{fontSize:12,color:"var(--sub)",marginInlineStart:"auto"}}>
          تعديلات معلّقة: <b style={{color:changedCount?"#e65100":"var(--sub)"}}>{changedCount}</b>
        </span>
      </div>

      {/* v40: عدّاد استهلاك الأراكيل — فحم + معسل */}
      <div className="card" style={{borderTop:"4px solid #455a64",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:10}}>
          <div>
            <div style={{fontWeight:800,fontSize:13}}>💨 استهلاك الأراكيل (تقديري)</div>
            <div style={{fontSize:11,color:"var(--sub)"}}>
              يشمل المدفوع + الدين + الضيافة • {HK_HEADS_PER_KG} رؤوس = 1 كغ فحم • {HK_HEADS_PER_PACK} رأساً = كف تفاحتين • {HK_HEADS_PER_TIN} رؤوس = علبة نكهة
            </div>
          </div>
          <div style={{display:"flex",gap:6}}>
            {[["today","يوم العمل"],["week","الأسبوع"],["month","الشهر"]].map(([v,l])=>(
              <button key={v} onClick={()=>setHkPeriod(v)} style={{padding:"5px 10px",borderRadius:14,border:"none",
                background:hkPeriod===v?"#455a64":"var(--card2)",color:hkPeriod===v?"#fff":"var(--sub)",fontWeight:700,fontSize:11,cursor:"pointer"}}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8}}>
          {[
            ["🪨 فحم",       `${charcoal.kg} كغ`,        `${charcoal.heads} رأس`,      "#455a64"],
            ["🍏 تفاحتين",   `${charcoal.daPacks} كف`,   `${charcoal.daHeads} رأس`,    "#2e7d32"],
            ["🫙 باقي النكهات",`${charcoal.otherTins} علبة`,`${charcoal.otherHeads} رأس`,"#6a1b9a"],
          ].map(([label,val,sub,color])=>(
            <div key={label} style={{background:"var(--card2)",borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
              <div style={{fontSize:11,color:"var(--sub)",fontWeight:700}}>{label}</div>
              <div style={{fontSize:19,fontWeight:900,color}}>{val}</div>
              <div style={{fontSize:10,color:"var(--sub)"}}>{sub}</div>
            </div>
          ))}
        </div>

        {charcoal.breakdown.length>0&&(
          <div style={{marginTop:10,paddingTop:8,borderTop:"1px dashed var(--border)"}}>
            <div style={{fontSize:11,color:"var(--sub)",fontWeight:700,marginBottom:5}}>تفصيل الرؤوس حسب النكهة</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {charcoal.breakdown.map(([n,q])=>(
                <span key={n} style={{fontSize:11,background:"var(--card2)",borderRadius:8,padding:"3px 8px",fontWeight:700}}>
                  {n} <b style={{color:"#455a64"}}>×{q}</b>
                </span>
              ))}
            </div>
          </div>
        )}
        <div style={{fontSize:10,color:"var(--sub)",marginTop:8}}>تقديري — لا يُخصم آلياً من المخزون، الجرد يدوي.</div>
      </div>

      {/* أصناف جديدة مقترحة */}
      {missingNew.length>0 && (
        <div className="card" style={{borderTop:"4px solid #2e7d32",marginBottom:12}}>
          <h3 style={{fontSize:14,fontWeight:800,color:"#2e7d32",marginBottom:8}}>➕ أصناف جديدة مقترحة للإضافة</h3>
          {missingNew.map(n=>(
            <label key={n.key} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",
              borderBottom:"1px solid var(--border)",fontSize:13,cursor:"pointer"}}>
              <input type="checkbox" checked={!!newSel[n.key]}
                onChange={e=>setNewSel(s=>({...s,[n.key]:e.target.checked}))}/>
              <span style={{flex:1}}>{n.emoji} {n.name}</span>
              <span style={{color:"var(--sub)",fontSize:12}}>تكلفة {n.cost} • بيع {_target(n.cost)} • جرد {n.stock}</span>
            </label>
          ))}
        </div>
      )}

      {/* جداول الجرد حسب الفئة */}
      {grouped.map(([cat,list])=>(
        <div key={cat} className="card" style={{marginBottom:12}}>
          <h3 style={{fontSize:14,fontWeight:800,marginBottom:10}}>{catLabel[cat]||cat} <span style={{color:"var(--sub)",fontSize:12,fontWeight:600}}>({list.length})</span></h3>
          {list.map(r=>{
            return (
              <div key={r.id} style={{display:"flex",alignItems:"flex-end",gap:8,flexWrap:"wrap",
                padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                <div style={{flex:"1 1 130px",minWidth:120}}>
                  <div style={{fontWeight:700,fontSize:13}}>{r.emoji} {r.name}</div>
                </div>
                <div><span style={lbl}>تكلفة</span>
                  <input value={r.cost} onChange={e=>upd(r.id,"cost",e.target.value)} inputMode="numeric" style={ipt}/></div>
                <div><span style={lbl}>مخزون</span>
                  {r.track
                    ? <input value={r.stock} onChange={e=>upd(r.id,"stock",e.target.value)} inputMode="numeric" style={ipt}/>
                    : <div style={{...ipt,opacity:.5,lineHeight:"22px"}}>—</div>}
                </div>
                <button onClick={()=>upd(r.id,"track",!r.track)}
                  style={{padding:"6px 10px",borderRadius:8,border:"none",cursor:"pointer",fontSize:11,fontWeight:800,
                    background:r.track?"#2e7d32":"#90a4ae",color:"#fff",minWidth:62}}>
                  {r.track?"حقيقي":"مفتوح"}
                </button>
              </div>
            );
          })}
        </div>
      ))}

      {/* حفظ */}
      <div style={{position:"sticky",bottom:80,marginTop:8}}>
        <button onClick={save}
          style={{width:"100%",padding:"14px",borderRadius:12,border:"none",
            background:"linear-gradient(135deg,#1b5e20,#2e7d32)",color:"#fff",fontWeight:900,fontSize:15,
            cursor:"pointer",boxShadow:"0 6px 18px rgba(46,125,50,.4)"}}>
          💾 حفظ الجرد ({changedCount} تعديل{missingNew.filter(n=>newSel[n.key]).length?` + ${missingNew.filter(n=>newSel[n.key]).length} جديد`:""})
        </button>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// v41 — سجل الوردية / الجرد اليومي  (لوحة التحكم)
// ───────────────────────────────────────────────────────────────────────
// اليوم المحاسبي بتوقيت غرينتش (UTC)، يبدأ الساعة DAY_START_UTC_HOUR.
// الوردية تُنسب لليوم الذي أُقفلت فيه. الوردية المفتوحة لا تدخل الجرد —
// تدخل جرد اليوم الذي ستُقفل فيه (مثال: الليلية تدخل جرد الغد).
// الأرقام لقطة ثابتة محفوظة لحظة الإقفال (سجل تدقيق لا يُعاد حسابه).
// ═══════════════════════════════════════════════════════════════════════
export function ShiftLogTab({ store, user, showToast, dm, settings }) {
  const CUR = settings?.currency || "ل.س";
  const [branch, setBranch] = useState("all");   // all | main | outdoor
  const [dayKey, setDayKey] = useState(() => businessDayKey());
  const [expanded, setExpanded] = useState(null);

  const days = useMemo(() => {
    const list = listBusinessDays(store.shifts);
    const todayKey = businessDayKey();
    return list.includes(todayKey) ? list : [todayKey, ...list];
  }, [store.shifts]);

  const branchFilter = branch === "all" ? null : branch;
  const dayShifts = useMemo(
    () => closedShiftsOfDay(store.shifts, dayKey, branchFilter),
    [store.shifts, dayKey, branchFilter]
  );
  const agg = useMemo(() => sumShifts(dayShifts), [dayShifts]);

  // الورديات المفتوحة الآن — تُعرض كتنبيه ولا تدخل الجرد
  const openShifts = useMemo(
    () => (store.shifts || []).filter(sh => sh.status === "open" && (!branchFilter || (sh.branch || "main") === branchFilter)),
    [store.shifts, branchFilter]
  );

  // التكلفة/الربح من طلبات ورديات هذا اليوم
  const dayProfit = useMemo(() => {
    const os = ordersOfShifts(store.orders, dayShifts).filter(o => o.status === "paid" && !o.isComplimentary);
    const cogs = os.reduce((a, o) => a + orderCogs(o, store.menu), 0);
    return { cogs, net: agg.totalSales - cogs - agg.expensesTotal };
  }, [store.orders, store.menu, dayShifts, agg]);

  const typeLabel = (t) => t === "night" ? "ليلية" : t === "evening" ? "مسائية" : t === "morning" ? "صباحية" : "—";
  const clock = (iso) => iso ? new Date(iso).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" }) : "—";
  const num = (v) => (+v || 0).toLocaleString();

  const exportDay = () => {
    const rows = dayShifts.map(sh => ({
      "الوردية": typeLabel(sh.shiftType),
      "الفرع": (sh.branch || "main") === "outdoor" ? "الحديقة" : "الكافيه",
      "الموظف": sh.userName || "",
      "الفتح": clock(sh.openedAt),
      "الإقفال": clock(sh.closedAt),
      "عدد الطلبات": +sh.ordersCount || 0,
      "نقدي": +sh.cashSales || 0,
      "بطاقة": +sh.cardSales || 0,
      "ترون": +sh.tronSales || 0,
      "ديون": +sh.debtTotal || 0,
      "ضيافة": +sh.compTotal || 0,
      "مصاريف": +sh.expensesTotal || 0,
      "إجمالي المبيعات": +sh.totalSales || 0,
      "المتوقع بالصندوق": +sh.expectedCash || 0,
      "المعدود": +sh.countedCash || 0,
      "الفرق": +sh.difference || 0,
    }));
    if (!rows.length) { showToast("لا توجد ورديات مقفلة في هذا اليوم", "warn"); return; }
    try { exportToExcel(rows, `سجل_الورديات_${dayKey}`); showToast("📊 تم التصدير"); }
    catch { showToast("تعذّر التصدير", "error"); }
  };

  const KPI = ({ label, value, color, hint }) => (
    <div className="card" style={{ padding: 12, textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 900, color }}>{num(value)} <span style={{ fontSize: 10, fontWeight: 700 }}>{CUR}</span></div>
      {hint && <div style={{ fontSize: 9, color: "var(--sub)", marginTop: 3 }}>{hint}</div>}
    </div>
  );

  const sel = { padding: "8px 12px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--card)", color: "inherit", fontWeight: 700, fontSize: 12, fontFamily: "inherit", cursor: "pointer" };

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>🕐 سجل الورديات — الجرد اليومي</h2>
      <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 14, lineHeight: 1.8 }}>
        اليوم المحاسبي بتوقيت غرينتش (UTC{DAY_START_UTC_HOUR ? `+${DAY_START_UTC_HOUR}س` : ""}) — مستقلّ عن توقيت الجهاز.
        <br />
        الوردية تدخل جرد اليوم الذي <strong>أُقفلت</strong> فيه؛ الوردية المفتوحة لا تدخل الجرد الحالي.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <select value={dayKey} onChange={e => { setDayKey(e.target.value); setExpanded(null); }} style={{ ...sel, minWidth: 200 }}>
          {days.map(d => <option key={d} value={d}>{formatDayKey(d)}</option>)}
        </select>
        <select value={branch} onChange={e => setBranch(e.target.value)} style={sel}>
          <option value="all">كل الفروع</option>
          <option value="main">الكافيه</option>
          <option value="outdoor">الحديقة</option>
        </select>
        <button onClick={exportDay} style={{ ...sel, background: "#1a237e", color: "#fff", border: "none" }}>📊 تصدير Excel</button>
      </div>

      {openShifts.length > 0 && (
        <div style={{ background: "rgba(230,81,0,.1)", border: "1.5px solid rgba(230,81,0,.3)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#e65100", fontWeight: 700, lineHeight: 1.8 }}>
          ⏳ {openShifts.length} وردية مفتوحة الآن ({openShifts.map(sh => typeLabel(sh.shiftType)).join("، ")}) — لا تدخل هذا الجرد.
          ستُحتسب في جرد اليوم الذي تُقفل فيه.
        </div>
      )}

      {!dayShifts.length ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--sub)" }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>🕐</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>لا توجد ورديات مقفلة في هذا اليوم</div>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 8 }}>
            <KPI label="إجمالي المبيعات" value={agg.totalSales} color="#2e7d32" hint={`${agg.ordersCount} فاتورة`} />
            <KPI label="نقدي" value={agg.cashSales} color="#1565c0" />
            <KPI label="بطاقة" value={agg.cardSales} color="#0288d1" />
            <KPI label="ترون (إكراميات)" value={agg.tronSales} color="#6a1b9a" />
            <KPI label="ديون" value={agg.debtTotal} color="#e65100" />
            <KPI label="ضيافة" value={agg.compTotal} color="#00897b" hint="تكلفة لا إيراد" />
            <KPI label="مصاريف" value={agg.expensesTotal} color="#c62828" />
            <KPI label="صافي الربح" value={dayProfit.net} color={dayProfit.net >= 0 ? "#2e7d32" : "#c62828"} hint={`تكلفة ${num(dayProfit.cogs)}`} />
          </div>

          <div className="card" style={{ padding: "10px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, fontSize: 12, fontWeight: 700 }}>
            <span>🔢 {agg.shiftsCount} وردية</span>
            <span>🧾 {agg.ordersCount} فاتورة</span>
            <span style={{ color: "var(--sub)" }}>متوقع: {num(agg.expectedCash)} {CUR}</span>
            <span style={{ color: "var(--sub)" }}>معدود: {num(agg.countedCash)} {CUR}</span>
            <span style={{ color: Math.abs(agg.difference) < 1 ? "#2e7d32" : agg.difference > 0 ? "#e65100" : "#c62828" }}>
              {Math.abs(agg.difference) < 1 ? "✅ مطابق" : agg.difference > 0 ? `▲ زيادة ${num(agg.difference)}` : `▼ عجز ${num(Math.abs(agg.difference))}`}
            </span>
          </div>

          <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>ورديات اليوم</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {dayShifts.map(sh => {
              const diff = +sh.difference || 0;
              const open = expanded === sh.id;
              return (
                <div key={sh.id} className="card" style={{ padding: 0, overflow: "hidden", borderRight: `4px solid ${Math.abs(diff) < 1 ? "#2e7d32" : diff > 0 ? "#e65100" : "#c62828"}` }}>
                  <div onClick={() => setExpanded(open ? null : sh.id)}
                    style={{ padding: "12px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: 14 }}>
                        {typeLabel(sh.shiftType)} — {(sh.branch || "main") === "outdoor" ? "🌿 الحديقة" : "☕ الكافيه"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 3 }}>
                        👤 {sh.userName || "—"} • {clock(sh.openedAt)} ← {clock(sh.closedAt)} • {+sh.ordersCount || 0} فاتورة
                      </div>
                    </div>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontWeight: 900, fontSize: 15, color: "#2e7d32" }}>{num(sh.totalSales)} {CUR}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: Math.abs(diff) < 1 ? "#2e7d32" : diff > 0 ? "#e65100" : "#c62828" }}>
                        {Math.abs(diff) < 1 ? "✅ صندوق مطابق" : diff > 0 ? `▲ زيادة ${num(diff)}` : `▼ عجز ${num(Math.abs(diff))}`}
                      </div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 900, color: "var(--sub)" }}>{open ? "▲" : "▼"}</span>
                  </div>
                  {open && (
                    <div style={{ background: "var(--card2)", padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8, fontSize: 12 }}>
                      {[
                        ["💵 نقدي", sh.cashSales, "#1565c0"],
                        ["💳 بطاقة", sh.cardSales, "#0288d1"],
                        ["💠 ترون", sh.tronSales, "#6a1b9a"],
                        ["💳 ديون", sh.debtTotal, "#e65100"],
                        ["🎁 ضيافة", sh.compTotal, "#00897b"],
                        ["📒 مصاريف", sh.expensesTotal, "#c62828"],
                        ["🔓 رصيد افتتاحي", sh.openingCash, "var(--sub)"],
                        ["📐 متوقع", sh.expectedCash, "var(--sub)"],
                        ["🔢 معدود", sh.countedCash, "var(--sub)"],
                      ].map(([l, v, c]) => (
                        <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                          <span style={{ color: "var(--sub)" }}>{l}</span>
                          <span style={{ fontWeight: 800, color: c }}>{num(v)}</span>
                        </div>
                      ))}
                      {sh.notes && (
                        <div style={{ gridColumn: "1/-1", background: "rgba(249,168,37,.12)", borderRadius: 8, padding: "7px 10px", fontSize: 11, color: "#e65100" }}>
                          📝 {sh.notes}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// v42 — سجل حركات المخزون
// ───────────────────────────────────────────────────────────────────────
// أثر تدقيق كامل: من غيّر، ماذا، كم، متى، ولماذا. يُكتب داخل نفس معاملة
// تعديل الرصيد في القاعدة، فيستحيل أن يتغيّر مخزون دون حركة مقابلة.
// السجل للقراءة والإضافة فقط — لا تعديل ولا حذف (سياسة RLS تفرض ذلك).
// ═══════════════════════════════════════════════════════════════════════
// v43: الجرد الدوري — مقارنة المحسوب بالفعلي وتسجيل الفارق كحركة correction.
// هذا ما يكشف الهدر والسرقة: النظام لا يعرف إلا ما سُجّل، والفرق بين رصيده
// والرصيد الفعلي على الرفّ هو الرقم الوحيد الذي يحكي ما لم يُسجَّل.
export function StockCountView({ store, user, showToast, settings }) {
  const [kind, setKind] = useState("menu");   // menu | supply
  const [counts, setCounts] = useState({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const openShift = (store.shifts || []).find(sh => sh.status === "open");
  const rows = useMemo(() => {
    const base = kind === "supply"
      ? (store.supplies || []).filter(x => x.active !== false)
          .map(x => ({ id: x.id, name: x.name, unit: x.unit || "", system: +x.qty || 0 }))
      : (store.menu || []).filter(m => !m.noStock && m.trackStock !== false)
          .map(m => ({ id: m.id, name: m.name, unit: "", system: +m.stock || 0 }));
    const q = search.trim();
    return q ? base.filter(r => (r.name || "").includes(q)) : base;
  }, [kind, store.menu, store.supplies, search]);

  const diffs = useMemo(() => rows
    .filter(r => counts[r.id] !== undefined && counts[r.id] !== "")
    .map(r => ({ ...r, counted: Math.max(0, +counts[r.id] || 0), delta: Math.max(0, +counts[r.id] || 0) - r.system }))
    .filter(r => r.delta !== 0), [rows, counts]);

  const applyCount = async () => {
    if (!diffs.length) { showToast("لا توجد فروقات لتسجيلها", "warn"); return; }
    setSaving(true);
    const key = "cnt_" + Date.now().toString(36);
    for (const d of diffs) {
      const meta = {
        reason: "correction", userId: user.id, userName: user.name, userRole: user.role,
        shiftId: openShift?.id || null, branch: "main",
        note: `جرد دوري — النظام ${d.system} / الفعلي ${d.counted}`,
        moveId: `mv_${key}_${d.id}_correction`,
      };
      try {
        if (kind === "supply") await store.adjustSupply(d.id, d.delta, meta);
        else                   await store.adjustStock(d.id, d.delta, meta);
      } catch (e) { console.warn("count:", e); }
    }
    try {
      logActivity({ action: "جرد دوري", details: `${diffs.length} فرق — ${kind === "supply" ? "مواد إضافية" : "أصناف المنيو"}`,
        userName: user.name, userRole: user.role, amount: diffs.reduce((a, d) => a + Math.abs(d.delta), 0), branch: "main" });
    } catch {}
    setCounts({}); setSaving(false);
    showToast(`✅ سُجّل الجرد — ${diffs.length} فرق`, "success");
  };

  const ipt = { width: 78, padding: "6px 8px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card2)", color: "inherit", fontWeight: 800, fontSize: 13, textAlign: "center", fontFamily: "inherit" };
  const sel = { padding: "8px 12px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--card)", color: "inherit", fontWeight: 700, fontSize: 12, fontFamily: "inherit", cursor: "pointer" };

  return (
    <div className="fade-in">
      <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 12, lineHeight: 1.8 }}>
        أدخل الكمية <strong>الفعلية على الرفّ</strong> لكل صنف. يُسجَّل الفارق عن رصيد النظام
        كحركة «تصحيح جرد» باسمك — فيبقى أثر دائم لما لم يُسجَّل.
        اترك الحقل فارغاً لأي صنف لم تعُدّه.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={kind} onChange={e => { setKind(e.target.value); setCounts({}); }} style={sel}>
          <option value="menu">أصناف المنيو</option>
          <option value="supply">مواد إضافية</option>
        </select>
        <input className="input" placeholder="🔍 بحث..." value={search}
          onChange={e => setSearch(e.target.value)} style={{ maxWidth: 190, fontSize: 12 }} />
      </div>

      {diffs.length > 0 && (
        <div className="card" style={{ marginBottom: 12, borderTop: "3px solid #e65100", padding: "12px 14px" }}>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>
            📋 {diffs.length} فرق — سيُسجَّل كتصحيح جرد
          </div>
          <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
            {diffs.slice(0, 12).map(d => (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                <span>{d.name}</span>
                <span style={{ fontWeight: 800, color: d.delta > 0 ? "#2e7d32" : "#c62828" }}>
                  {d.system} ← {d.counted} ({d.delta > 0 ? "+" : ""}{d.delta})
                </span>
              </div>
            ))}
            {diffs.length > 12 && <div style={{ fontSize: 10.5, color: "var(--sub)" }}>+{diffs.length - 12} صنف آخر</div>}
          </div>
          <button onClick={applyCount} disabled={saving}
            style={{ width: "100%", background: saving ? "#999" : "#e65100", color: "#fff", border: "none", borderRadius: 10, padding: 12, fontWeight: 800, fontSize: 14, cursor: saving ? "wait" : "pointer", fontFamily: "inherit" }}>
            {saving ? "⏳ جارٍ التسجيل..." : "✓ تسجيل الجرد"}
          </button>
        </div>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        {rows.map(r => {
          const v = counts[r.id];
          const d = (v === undefined || v === "") ? null : Math.max(0, +v || 0) - r.system;
          return (
            <div key={r.id} className="card" style={{ padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{r.name}</div>
                <div style={{ fontSize: 10.5, color: "var(--sub)" }}>
                  النظام: {r.system}{r.unit ? ` ${r.unit}` : ""}
                  {d !== null && d !== 0 && (
                    <span style={{ color: d > 0 ? "#2e7d32" : "#c62828", fontWeight: 800, marginRight: 8 }}>
                      {d > 0 ? "▲ زيادة" : "▼ عجز"} {Math.abs(d)}
                    </span>
                  )}
                </div>
              </div>
              <input type="number" min="0" inputMode="numeric" style={ipt} placeholder="الفعلي"
                value={v ?? ""} onChange={e => setCounts(m => ({ ...m, [r.id]: e.target.value }))} />
            </div>
          );
        })}
        {!rows.length && <div className="card" style={{ textAlign: "center", padding: 30, color: "var(--sub)" }}>لا توجد أصناف</div>}
      </div>
    </div>
  );
}

export function StockLogTab({ store, user, showToast, dm, settings }) {
  const [view, setView] = useState("log");         // log | count
  const [period, setPeriod] = useState("today");   // today | week | all
  const [kind,   setKind]   = useState("all");     // all | menu | supply
  const [reason, setReason] = useState("all");
  const [search, setSearch] = useState("");

  const from = useMemo(() => {
    if (period === "today") return businessDayStart();
    if (period === "week")  return weekStartThursday();
    return new Date(0);
  }, [period]);

  const res = useMemo(() => summarizeMovements(store.stockMoves || [], {
    from,
    kind:   kind   === "all" ? null : kind,
    reason: reason === "all" ? null : reason,
  }), [store.stockMoves, from, kind, reason]);

  const rows = useMemo(() => {
    const q = search.trim();
    if (!q) return res.list;
    return res.list.filter(m =>
      (m.itemName || "").includes(q) || (m.userName || "").includes(q) || (m.note || "").includes(q));
  }, [res.list, search]);

  const exportLog = () => {
    if (!rows.length) { showToast("لا توجد حركات للتصدير", "warn"); return; }
    try {
      exportToExcel(rows.map(m => ({
        "التاريخ": new Date(m.at).toLocaleString("ar-SY"),
        "النوع": m.kind === "supply" ? "مادة إضافية" : "صنف منيو",
        "الصنف": m.itemName,
        "الحركة": m.delta > 0 ? `+${m.delta}` : String(m.delta),
        "الرصيد بعدها": m.qtyAfter ?? "",
        "السبب": reasonLabel(m.reason),
        "المستخدم": m.userName,
        "الدور": m.userRole,
        "الطلب": m.orderNum || "",
        "ملاحظة": m.note || "",
      })), `سجل_المخزون_${new Date().toISOString().slice(0, 10)}`);
      showToast("📊 تم التصدير");
    } catch { showToast("تعذّر التصدير", "error"); }
  };

  const sel = { padding: "8px 12px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--card)", color: "inherit", fontWeight: 700, fontSize: 12, fontFamily: "inherit", cursor: "pointer" };

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>📦 المخزون</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[["log", "📋 سجل الحركات"], ["count", "🔢 الجرد الدوري"]].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)}
            style={{ padding: "8px 18px", borderRadius: 20, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
              background: view === v ? "#c62828" : "var(--card2)", color: view === v ? "#fff" : "var(--sub)" }}>
            {l}
          </button>
        ))}
      </div>

      {view === "count" ? <StockCountView store={store} user={user} showToast={showToast} settings={settings} /> : (<>
      <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 14, lineHeight: 1.8 }}>
        كل تغيّر في المخزون مسجَّل هنا: من غيّره، كم، متى، ولماذا.
        السجل غير قابل للتعديل أو الحذف — أثر تدقيق دائم.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <select value={period} onChange={e => setPeriod(e.target.value)} style={sel}>
          <option value="today">اليوم</option>
          <option value="week">هذا الأسبوع</option>
          <option value="all">الكل</option>
        </select>
        <select value={kind} onChange={e => setKind(e.target.value)} style={sel}>
          <option value="all">كل الأنواع</option>
          <option value="menu">أصناف المنيو</option>
          <option value="supply">مواد إضافية</option>
        </select>
        <select value={reason} onChange={e => setReason(e.target.value)} style={sel}>
          <option value="all">كل الأسباب</option>
          {Object.entries(MOVE_REASONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className="input" placeholder="🔍 صنف / موظف / ملاحظة..." value={search}
          onChange={e => setSearch(e.target.value)} style={{ maxWidth: 210, fontSize: 12 }} />
        <button onClick={exportLog} style={{ ...sel, background: "#1a237e", color: "#fff", border: "none" }}>📊 تصدير</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 16 }}>
        {[["عدد الحركات", res.count, "#1565c0"], ["إجمالي المُضاف", res.added, "#2e7d32"], ["إجمالي المخصوم", res.removed, "#c62828"], ["الصافي", res.net, res.net >= 0 ? "#2e7d32" : "#c62828"]].map(([l, v, c]) => (
          <div key={l} className="card" style={{ padding: 12, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: c }}>{(+v || 0).toLocaleString()}</div>
          </div>
        ))}
      </div>

      {!rows.length ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--sub)" }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>📦</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>لا توجد حركات في هذه الفترة</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 7 }}>
          {rows.slice(0, 300).map(m => {
            const up = m.delta > 0;
            return (
              <div key={m.id} className="card" style={{ padding: "10px 13px", borderRight: `4px solid ${up ? "#2e7d32" : "#c62828"}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>
                    {m.kind === "supply" ? "🧂" : "🍹"} {m.itemName || m.itemId}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 3 }}>
                    👤 {m.userName || "—"}{m.userRole ? ` (${ROLE_LABELS[m.userRole] || m.userRole})` : ""}
                    {" • "}{new Date(m.at).toLocaleString("ar-SY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {m.orderNum ? ` • 🧾 #${m.orderNum}` : ""}
                    {m.note ? ` • 📝 ${m.note}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                  <div style={{ fontWeight: 900, fontSize: 15, color: up ? "#2e7d32" : "#c62828" }}>
                    {up ? "+" : ""}{(+m.delta || 0).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--sub)" }}>
                    {reasonLabel(m.reason)}{m.qtyAfter != null ? ` • رصيد ${(+m.qtyAfter).toLocaleString()}` : ""}
                  </div>
                </div>
              </div>
            );
          })}
          {rows.length > 300 && (
            <div style={{ textAlign: "center", fontSize: 11, color: "var(--sub)", padding: 10 }}>
              تُعرض أحدث 300 حركة من أصل {rows.length} — استخدم المرشّحات أو صدّر لملف
            </div>
          )}
        </div>
      )}
      </>)}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════
// v43 — أداء الموظفين
// ───────────────────────────────────────────────────────────────────────
// يُبنى من لقطات الورديات المُقفلة لا من الطلبات: الطلبات مبتورة عند 500
// صف، أما الورديات فصفٌّ واحد لكل وردية — سجل كامل وثابت.
// فروقات الصندوق هي المؤشّر الأهم هنا: عجز متكرّر عند موظّف بعينه إشارة
// تستحقّ النظر، لكنها ليست إثباتاً — قد تكون خطأ عدّ أو مصروفاً غير مسجَّل.
// ═══════════════════════════════════════════════════════════════════════
export function StaffPerformanceView({ store, settings, showToast }) {
  const CUR = settings?.currency || "ل.س";
  const [period, setPeriod] = useState("week");
  const [res, setRes] = useState({ exact: false, rows: [] });
  const [loading, setLoading] = useState(true);

  const from = useMemo(() => {
    if (period === "today") return businessDayStart();
    if (period === "week")  return weekStartThursday();
    if (period === "month") { const d = businessDayStart(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
    return null;
  }, [period]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchStaffPerformance(store.shifts, { from })
      .then(r => { if (alive) { setRes(r); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [store.shifts, from]);

  const n = (v) => (+v || 0).toLocaleString();
  const sel = { padding: "8px 12px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--card)", color: "inherit", fontWeight: 700, fontSize: 12, fontFamily: "inherit", cursor: "pointer" };

  const exportRows = () => {
    if (!res.rows.length) { showToast("لا توجد بيانات", "warn"); return; }
    try {
      exportToExcel(res.rows.map(r => ({
        "الموظف": r.userName, "عدد الورديات": r.shiftsCount, "عدد الفواتير": r.ordersCount,
        "إجمالي المبيعات": r.totalSales, "نقدي": r.cashSales, "ترون": r.tronSales,
        "ضيافة": r.compTotal, "ديون": r.debtTotal, "مصاريف": r.expensesTotal,
        "صافي فروقات الصندوق": r.varianceSum, "مجموع الفروقات المطلقة": r.varianceAbs,
        "أسوأ عجز": r.worstVariance,
      })), `أداء_الموظفين_${new Date().toISOString().slice(0, 10)}`);
      showToast("📊 تم التصدير");
    } catch { showToast("تعذّر التصدير", "error"); }
  };

  return (
    <div className="fade-in">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <select value={period} onChange={e => setPeriod(e.target.value)} style={sel}>
          <option value="today">اليوم</option>
          <option value="week">هذا الأسبوع</option>
          <option value="month">هذا الشهر</option>
          <option value="all">كل الوقت</option>
        </select>
        <button onClick={exportRows} style={{ ...sel, background: "#1a237e", color: "#fff", border: "none" }}>📊 تصدير</button>
        {!loading && !res.exact && (
          <span style={{ fontSize: 10.5, color: "#e65100", fontWeight: 700 }}>{approxNote(false)}</span>
        )}
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: "center", padding: 30, color: "var(--sub)" }}>⏳ جارٍ الحساب...</div>
      ) : !res.rows.length ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--sub)" }}>
          <div style={{ fontSize: 44, marginBottom: 10 }}>👨‍💼</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>لا توجد ورديات مُقفلة في هذه الفترة</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {res.rows.map((r, i) => {
            const avg = r.ordersCount ? r.totalSales / r.ordersCount : 0;
            const varColor = Math.abs(r.varianceSum) < 1 ? "#2e7d32" : r.varianceSum > 0 ? "#e65100" : "#c62828";
            return (
              <div key={r.userName} className="card" style={{ borderRight: `4px solid ${i === 0 ? "#f9a825" : "var(--border)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontWeight: 900, fontSize: 15 }}>
                    {i === 0 ? "🥇 " : ""}{r.userName}
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--sub)", marginRight: 8 }}>
                      {r.shiftsCount} وردية · {r.ordersCount} فاتورة
                    </span>
                  </div>
                  <div style={{ fontWeight: 900, fontSize: 16, color: "#2e7d32" }}>{approxMark(res.exact)}{n(r.totalSales)} {CUR}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(115px,1fr))", gap: 8, fontSize: 11.5 }}>
                  {[
                    ["💵 نقدي", n(r.cashSales), "#1565c0"],
                    ["💠 ترون", n(r.tronSales), "#6a1b9a"],
                    ["🎁 ضيافة", n(r.compTotal), "#00897b"],
                    ["💳 ديون", n(r.debtTotal), "#e65100"],
                    ["📒 مصاريف", n(r.expensesTotal), "#c62828"],
                    ["🧾 متوسط الفاتورة", n(Math.round(avg)), "var(--sub)"],
                  ].map(([l, v, c]) => (
                    <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                      <span style={{ color: "var(--sub)" }}>{l}</span><span style={{ fontWeight: 800, color: c }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--border)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 11.5, fontWeight: 700 }}>
                  <span style={{ color: "var(--sub)" }}>فروقات الصندوق</span>
                  <span style={{ color: varColor }}>
                    صافي {r.varianceSum > 0 ? "+" : ""}{n(r.varianceSum)} · مطلق {n(r.varianceAbs)}
                    {r.worstVariance < 0 ? ` · أسوأ عجز ${n(r.worstVariance)}` : ""}
                  </span>
                </div>
              </div>
            );
          })}
          <div style={{ fontSize: 10.5, color: "var(--sub)", lineHeight: 1.8, padding: "6px 4px" }}>
            ℹ️ فروقات الصندوق مؤشّر لا إثبات — قد تنشأ من خطأ عدّ أو مصروف غير مسجَّل.
            راجعها مع الموظف قبل أي استنتاج.
          </div>
        </div>
      )}
    </div>
  );
}
