// شاشات المحطات (بار/أراكيل) — مفصولة من App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore, checkSessionExpiry, touchSession } from "./lib/store.js";
import { SUPABASE_READY, sbDeleteAll, sbDelete, sbUpsert, sbFetch } from "./lib/supabase.js";
import OutdoorScreen from "./OutdoorScreen.jsx";
import { playOrderAlert, exportToExcel, generateTableQR, checkStockAlerts, notifyLowStock, sendReceiptWhatsApp, printKitchenTicket, getLoyaltyStatus, calcLoyaltyDiscount, getPartialPaymentStatus, getStaffReport, getPeakHoursData, getSalesComparison, calcShiftSummary, getOrderUrgency, getAvgPrepTime, calcEarnedPoints, getCustomerTier, pointsToValue } from "./lib/utils.js";
import { ROLES, ROLE_LABELS, ROLE_COLORS, ORDER_STATUS, STATUS_LABELS, STATUS_COLORS, CAT_LABELS, CAT_ORDER, BAR_CATS, HOOKAH_CATS, STATION_CATS, PERMISSIONS, THEMES, catOf, orderFullyPrepared, canAccess } from "./constants.js";
import { ItemVisual, BottomNav, GlobalStyle, Toast, PWABanner, OrderTimer } from "./uikit.jsx";
import { printOrder, generateReceiptPDF, saveReceiptRecord, saveReceipt } from "./receipts.js";
import { newSupplyId } from "./lib/stockLog.js"; // v42

export function BarTab({store,user,showToast,addNotification,dm,settings}){
  const canDecrease=user.role===ROLES.ADMIN||(settings?.workerCanDecreaseStock??false);
  // ══════════════════════════════════════════════════════════════
  // v42: المواد الإضافية من جدول supplies المستقلّ لا من settings.extraStock
  // كان الحقل القديم JSONB واحداً: جهازان يعدّلان معاً ⇒ آخر كتابة تمحو
  // الأخرى بصمت. الآن كل مادة صفٌّ مستقلّ، والتعديل بفارق نسبي ذرّي.
  // ══════════════════════════════════════════════════════════════
  const supplies = (store.supplies || []).filter(x=>x.active!==false);
  const [showSup,setShowSup]=useState(false);
  const [supForm,setSupForm]=useState({name:"",unit:"",qty:"",minStock:""});
  const [busy,setBusy]=useState({});
  const lbl={fontSize:11,fontWeight:700,color:"var(--sub)",marginBottom:4,display:"block"};
  const openShift=(store.shifts||[]).find(sh=>sh.status==="open"&&sh.branch==="main");
  const moveMeta=(reason,note)=>({reason,note:note||"",userId:user.id,userName:user.name,userRole:user.role,shiftId:openShift?.id||null,branch:"main"});
  const addSupply=async()=>{
    if(!supForm.name.trim()){showToast("أدخل اسم المادة","error");return;}
    const qty=Math.max(0,+supForm.qty||0);
    const sup={id:newSupplyId(),name:supForm.name.trim(),unit:supForm.unit.trim(),qty:0,minStock:Math.max(0,+supForm.minStock||0),branch:"main",active:true};
    store.setSupplies(p=>[...p,sup]);
    if(qty>0) await store.adjustSupply(sup.id,qty,moveMeta("restock","رصيد افتتاحي"));
    setSupForm({name:"",unit:"",qty:"",minStock:""}); setShowSup(false);
    showToast("تمت إضافة المادة");
  };
  const adjustSupply=async(id,d)=>{
    if(d<0&&!canDecrease){showToast("غير مسموح بتخفيض المخزون","warn");return}
    setBusy(m=>({...m,[id]:true}));
    const r=await store.adjustSupply(id,d,moveMeta(d>0?"restock":"correction"));
    setBusy(m=>{const n={...m};delete n[id];return n;});
    if(r&&r.ok===false&&r.reason!=="noop") showToast("⚠ تعذّر تعديل المخزون — أعد المحاولة","error");
  };
  const removeSupply=(id)=>store.setSupplies(p=>p.filter(s=>s.id!==id));
  // v41: إضافة بكميّة — البار يزيد فقط (لا تخفيض) بقيم أكبر من 1
  const [addQty,setAddQty]=useState({});          // itemId -> نص الكمية لأصناف المنيو
  const [supQty,setSupQty]=useState({});          // supplyId -> نص الكمية للمواد الإضافية
  const readQty=(map,id)=>{ const n=Math.floor(+map[id]); return (isNaN(n)||n<1)?1:Math.min(n,9999); };
  const bumpStock=async(id,map,setMap)=>{
    const q=readQty(map,id);
    setMap(m=>({...m,[id]:""}));
    const r=await updateStock(id,q);
    if(r!==false) showToast(`➕ أُضيف ${q} إلى المخزون`,"success");
  };
  const bumpSupply=async(id,name)=>{
    const q=readQty(supQty,id);
    setSupQty(m=>({...m,[id]:""}));
    await adjustSupply(id,q);
    showToast(`➕ أُضيف ${q}${name?` إلى ${name}`:""}`,"success");
  };
  const qtyBox={width:56,height:30,textAlign:"center",fontWeight:800,fontSize:13,borderRadius:8,border:"1.5px solid var(--border)",background:"var(--card2)",color:"inherit",fontFamily:"inherit"};
  const chip=(active)=>({minWidth:30,height:26,padding:"0 7px",borderRadius:7,border:"none",cursor:"pointer",fontWeight:800,fontSize:11,background:active?"rgba(46,125,50,.3)":"rgba(46,125,50,.12)",color:"#2e7d32"});
  const barOrders=store.orders.filter(o=>
    ["pending","preparing"].includes(o.status)&&
    o.items.some(i=>BAR_CATS.includes(store.menu.find(m=>m.id===i.itemId)?.category)&&!i.prepared)
  ).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const barItems=store.menu.filter(m=>["hot_drinks","cold_drinks"].includes(m.category));

  // v42: تعديل بفارق نسبي ذرّي + تسجيل الحركة (من/كم/متى/لماذا)
  const updateStock=async(id,delta)=>{
    if(delta<0&&!canDecrease){showToast("غير مسموح بتخفيض المخزون","warn");return}
    setBusy(m=>({...m,[id]:true}));
    const r=await store.adjustStock(id,delta,moveMeta(delta>0?"restock":"correction"));
    setBusy(m=>{const n={...m};delete n[id];return n;});
    if(r&&r.ok===false&&r.reason!=="noop") showToast("⚠ تعذّر تعديل المخزون — أعد المحاولة","error");
  };
  const markReady=(order)=>{
    store.setOrders(p=>p.map(o=>{
      if(o.id!==order.id) return o;
      const items=o.items.map(i=>BAR_CATS.includes(store.menu.find(m=>m.id===i.itemId)?.category)?{...i,prepared:true}:i);
      const fully=orderFullyPrepared({...o,items},store.menu);
      return {...o,items,status:fully?"ready":"preparing",
        readyAt:fully?new Date().toISOString():o.readyAt,
        preparingAt:o.preparingAt||new Date().toISOString()};
    }));
    addNotification(`✅ مشروبات طلب #${order.orderNum} جاهزة من البار`,[ROLES.CASHIER,ROLES.ADMIN,ROLES.WORKER],order.id);
    showToast(`مشروبات طلب #${order.orderNum} جاهزة ✅`);
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
                    <ItemVisual item={store.menu.find(m=>m.id===i.itemId)||i} size={28} round={7}/>
                    <span style={{fontWeight:600}}>{i.itemName}</span>
                    <span style={{marginRight:"auto",fontWeight:900,color:"#c62828"}}>×{i.qty}</span>
                  </div>
                ))}
                {order.notes&&<div style={{background:"rgba(249,168,37,.1)",borderRadius:6,padding:"5px 8px",fontSize:11,color:"#e65100",marginTop:6}}>📝 {order.notes}</div>}
                <div style={{display:"flex",gap:8,marginTop:10}}>
                  {order.status==="pending"&&(
                    <button onClick={()=>store.setOrders(p=>p.map(o=>o.id===order.id?{...o,status:"preparing",preparingAt:new Date().toISOString()}:o))}
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
              <ItemVisual item={item} size={40} round={10}/>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:12}}>{item.name}</div>
                <div style={{fontSize:10,color:item.trackStock===false?"#90a4ae":((item.stock||0)<1?"#c62828":"var(--sub)")}}>
                  {item.trackStock===false ? "⊘ مفتوح (بلا عدّ)" : `${(item.stock||0)<1?"⚠ نفد":"✓ متوفر"} — ${item.stock}`}
                </div>
              </div>
            </div>
            {item.trackStock!==false && (<>
            <div style={{height:5,background:"var(--border)",borderRadius:4,marginBottom:10}}>
              <div style={{height:"100%",width:`${Math.min(100,(item.stock/Math.max(item.minStock*2,1))*100)}%`,
                background:(item.stock||0)<1?"#c62828":"#2e7d32",borderRadius:4}}/>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",justifyContent:"center",marginBottom:6}}>
              {canDecrease&&(
                <button onClick={()=>updateStock(item.id,-1)}
                  style={{width:30,height:30,background:"rgba(198,40,40,.15)",color:"#c62828",border:"none",borderRadius:8,fontWeight:900,fontSize:16}}>
                  −
                </button>
              )}
              <span style={{fontWeight:900,fontSize:15,minWidth:30,textAlign:"center"}}>{item.stock}</span>
            </div>
            {/* v41: إضافة بكميّة حرّة — زيادة فقط */}
            <div style={{display:"flex",gap:4,alignItems:"center",justifyContent:"center",flexWrap:"wrap"}}>
              {[1,5,10,24].map(q=>(
                <button key={q} onClick={()=>setAddQty(m=>({...m,[item.id]:String(q)}))}
                  style={chip(readQty(addQty,item.id)===q&&(addQty[item.id]||"")!=="")}>+{q}</button>
              ))}
              <input type="number" min="1" inputMode="numeric" style={qtyBox}
                value={addQty[item.id]??""} placeholder="1"
                onChange={e=>setAddQty(m=>({...m,[item.id]:e.target.value}))}
                onKeyDown={e=>{ if(e.key==="Enter") bumpStock(item.id,addQty,setAddQty); }}/>
              <button onClick={()=>bumpStock(item.id,addQty,setAddQty)}
                style={{height:30,padding:"0 12px",background:"#2e7d32",color:"#fff",border:"none",borderRadius:8,fontWeight:900,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                ＋ إضافة
              </button>
            </div>
            </>)}
          </div>
        ))}
      </div>

      {/* مخزون إضافي: مواد لا تُقدَّم في المنيو (سكر/غاز/فحم...) */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:22,marginBottom:10}}>
        <h3 style={{fontSize:14,fontWeight:800}}>🧂 مخزون إضافي</h3>
        <button onClick={()=>setShowSup(s=>!s)} className="btn btn-red" style={{padding:"6px 12px",fontSize:12}}>{showSup?"إغلاق":"+ إضافة مادة"}</button>
      </div>
      {showSup&&(
        <div className="card" style={{marginBottom:12,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,alignItems:"end"}}>
          <div><label style={lbl}>الاسم</label><input className="input" value={supForm.name} onChange={e=>setSupForm(f=>({...f,name:e.target.value}))} placeholder="سكر / غاز / فحم"/></div>
          <div><label style={lbl}>الوحدة</label><input className="input" value={supForm.unit} onChange={e=>setSupForm(f=>({...f,unit:e.target.value}))} placeholder="كغ / قطعة"/></div>
          <div><label style={lbl}>الكمية</label><input className="input" type="number" value={supForm.qty} onChange={e=>setSupForm(f=>({...f,qty:e.target.value}))}/></div>
          <div><label style={lbl}>حد التنبيه</label><input className="input" type="number" value={supForm.minStock} onChange={e=>setSupForm(f=>({...f,minStock:e.target.value}))}/></div>
          <button onClick={addSupply} className="btn btn-red" style={{height:40}}>حفظ</button>
        </div>
      )}
      {supplies.length===0?(
        <div style={{color:"var(--sub)",fontSize:13,textAlign:"center",padding:16}}>لا توجد مواد بعد</div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:10}}>
          {supplies.map(s=>{ const low=(+s.qty||0)<=(+s.minStock||0); return(
            <div key={s.id} className="card">
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{fontSize:22}}>🧂</span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:12}}>{s.name}</div>
                  <div style={{fontSize:10,color:low?"#c62828":"var(--sub)"}}>{low?"⚠ منخفض":"✓ متوفر"}{s.unit?` — ${s.unit}`:""}</div>
                </div>
                <button onClick={()=>removeSupply(s.id)} style={{background:"rgba(198,40,40,.12)",color:"#c62828",border:"none",borderRadius:8,padding:"4px 8px",fontSize:12}}>🗑</button>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",justifyContent:"center",marginBottom:6}}>
                {canDecrease&&(
                  <button onClick={()=>adjustSupply(s.id,-1)} style={{width:30,height:30,background:"rgba(198,40,40,.15)",color:"#c62828",border:"none",borderRadius:8,fontWeight:900,fontSize:16}}>−</button>
                )}
                <span style={{fontWeight:900,fontSize:14,minWidth:44,textAlign:"center",color:low?"#c62828":"inherit"}}>{(+s.qty||0).toLocaleString()}{s.unit?` ${s.unit}`:""}</span>
              </div>
              {/* v41: إضافة بكميّة حرّة — زيادة فقط */}
              <div style={{display:"flex",gap:4,alignItems:"center",justifyContent:"center",flexWrap:"wrap"}}>
                {[1,5,10].map(q=>(
                  <button key={q} onClick={()=>setSupQty(m=>({...m,[s.id]:String(q)}))}
                    style={chip(readQty(supQty,s.id)===q&&(supQty[s.id]||"")!=="")}>+{q}</button>
                ))}
                <input type="number" min="1" inputMode="numeric" style={qtyBox}
                  value={supQty[s.id]??""} placeholder="1"
                  onChange={e=>setSupQty(m=>({...m,[s.id]:e.target.value}))}
                  onKeyDown={e=>{ if(e.key==="Enter") bumpSupply(s.id,s.name); }}/>
                <button onClick={()=>bumpSupply(s.id,s.name)}
                  style={{height:30,padding:"0 12px",background:"#2e7d32",color:"#fff",border:"none",borderRadius:8,fontWeight:900,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                  ＋ إضافة
                </button>
              </div>
            </div>
          );})}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════
// HOOKAH TAB (Narghile)
// ═══════════════════════════════════

export function HookahTab({store,user,showToast,addNotification,dm,settings}){
  const canDecrease=user.role===ROLES.ADMIN||(settings?.workerCanDecreaseStock??false);
  const hookahOrders=store.orders.filter(o=>
    ["pending","preparing"].includes(o.status)&&
    o.items.some(i=>store.menu.find(m=>m.id===i.itemId)?.category==="hookah"&&!i.prepared)
  ).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const hookahItems=store.menu.filter(m=>m.category==="hookah");

  // v42: تعديل بفارق نسبي ذرّي + تسجيل الحركة
  const openShiftH=(store.shifts||[]).find(sh=>sh.status==="open"&&sh.branch==="main");
  const updateStock=async(id,delta)=>{
    if(delta<0&&!canDecrease){showToast("غير مسموح بتخفيض المخزون","warn");return}
    const r=await store.adjustStock(id,delta,{reason:delta>0?"restock":"correction",userId:user.id,userName:user.name,userRole:user.role,shiftId:openShiftH?.id||null,branch:"main"});
    if(r&&r.ok===false&&r.reason!=="noop") showToast("⚠ تعذّر تعديل المخزون — أعد المحاولة","error");
  };
  // v41: إضافة بكميّة — زيادة فقط
  const [addQty,setAddQty]=useState({});
  const readQty=(map,id)=>{ const n=Math.floor(+map[id]); return (isNaN(n)||n<1)?1:Math.min(n,9999); };
  const bumpStock=async(id)=>{ const q=readQty(addQty,id); setAddQty(m=>({...m,[id]:""})); await updateStock(id,q); showToast(`➕ أُضيف ${q} إلى المخزون`,"success"); };
  const qtyBox={width:56,height:30,textAlign:"center",fontWeight:800,fontSize:13,borderRadius:8,border:"1.5px solid var(--border)",background:"var(--card2)",color:"inherit",fontFamily:"inherit"};
  const chip=(active)=>({minWidth:30,height:26,padding:"0 7px",borderRadius:7,border:"none",cursor:"pointer",fontWeight:800,fontSize:11,background:active?"rgba(106,27,154,.3)":"rgba(106,27,154,.12)",color:"#6a1b9a"});
  const markReady=(order)=>{
    store.setOrders(p=>p.map(o=>{
      if(o.id!==order.id) return o;
      const items=o.items.map(i=>store.menu.find(m=>m.id===i.itemId)?.category==="hookah"?{...i,prepared:true}:i);
      const fully=orderFullyPrepared({...o,items},store.menu);
      return {...o,items,status:fully?"ready":"preparing",
        readyAt:fully?new Date().toISOString():o.readyAt,
        preparingAt:o.preparingAt||new Date().toISOString()};
    }));
    addNotification(`✅ أراكيل طلب #${order.orderNum} جاهزة`,[ROLES.CASHIER,ROLES.ADMIN,ROLES.WORKER],order.id);
    showToast(`أراكيل طلب #${order.orderNum} جاهزة ✅`);
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
                    <ItemVisual item={store.menu.find(m=>m.id===i.itemId)||i} size={26} round={7}/><span style={{fontWeight:600}}>{i.itemName}</span>
                    <span style={{marginRight:"auto",fontWeight:900,color:"#c62828"}}>×{i.qty}</span>
                  </div>
                ))}
                {order.notes&&<div style={{background:"rgba(249,168,37,.1)",borderRadius:6,padding:"5px 8px",fontSize:11,color:"#e65100",marginTop:6}}>📝 {order.notes}</div>}
                <div style={{display:"flex",gap:8,marginTop:10}}>
                  {order.status==="pending"&&(
                    <button onClick={()=>store.setOrders(p=>p.map(o=>o.id===order.id?{...o,status:"preparing",preparingAt:new Date().toISOString()}:o))}
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
            <div style={{textAlign:"center",marginBottom:6}}><ItemVisual item={item} size={40} round={10}/></div>
            <div style={{fontWeight:700,fontSize:12,textAlign:"center",marginBottom:6}}>{item.name}</div>
            {item.trackStock===false ? (
              <div style={{fontSize:11,color:"#90a4ae",textAlign:"center",fontWeight:700}}>⊘ مفتوح (بلا عدّ)</div>
            ) : (<>
            <div style={{height:5,background:"var(--border)",borderRadius:4,marginBottom:10}}>
              <div style={{height:"100%",width:`${Math.min(100,(item.stock/Math.max(item.minStock*2,1))*100)}%`,
                background:(item.stock||0)<1?"#c62828":"#6a1b9a",borderRadius:4}}/>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",justifyContent:"center"}}>
              {canDecrease&&(
                <button onClick={()=>updateStock(item.id,-1)}
                  style={{width:30,height:30,background:"rgba(198,40,40,.15)",color:"#c62828",border:"none",borderRadius:8,fontWeight:900,fontSize:16}}>
                  −
                </button>
              )}
              <span style={{fontWeight:900,fontSize:15,minWidth:30,textAlign:"center"}}>{item.stock}</span>
            </div>
            {/* v41: إضافة بكميّة حرّة — زيادة فقط */}
            <div style={{display:"flex",gap:4,alignItems:"center",justifyContent:"center",flexWrap:"wrap",marginTop:6}}>
              {[1,5,10,24].map(q=>(
                <button key={q} onClick={()=>setAddQty(m=>({...m,[item.id]:String(q)}))}
                  style={chip(readQty(addQty,item.id)===q&&(addQty[item.id]||"")!=="")}>+{q}</button>
              ))}
              <input type="number" min="1" inputMode="numeric" style={qtyBox}
                value={addQty[item.id]??""} placeholder="1"
                onChange={e=>setAddQty(m=>({...m,[item.id]:e.target.value}))}
                onKeyDown={e=>{ if(e.key==="Enter") bumpStock(item.id); }}/>
              <button onClick={()=>bumpStock(item.id)}
                style={{height:30,padding:"0 12px",background:"#6a1b9a",color:"#fff",border:"none",borderRadius:8,fontWeight:900,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                ＋ إضافة
              </button>
            </div>
            </>)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════
// MENU TAB (Admin)
// ═══════════════════════════════════
