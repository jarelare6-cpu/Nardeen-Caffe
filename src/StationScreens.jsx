// شاشات المحطات (بار/أراكيل) — مفصولة من App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore, checkSessionExpiry, touchSession } from "./lib/store.js";
import { SUPABASE_READY, sbDeleteAll, sbDelete, sbUpsert, sbFetch } from "./lib/supabase.js";
import OutdoorScreen from "./OutdoorScreen.jsx";
import { playOrderAlert, exportToExcel, generateTableQR, checkStockAlerts, notifyLowStock, sendReceiptWhatsApp, printKitchenTicket, getLoyaltyStatus, calcLoyaltyDiscount, getPartialPaymentStatus, getStaffReport, getPeakHoursData, getSalesComparison, calcShiftSummary, getOrderUrgency, getAvgPrepTime, calcEarnedPoints, getCustomerTier, pointsToValue } from "./lib/utils.js";
import { ROLES, ROLE_LABELS, ROLE_COLORS, ORDER_STATUS, STATUS_LABELS, STATUS_COLORS, CAT_LABELS, CAT_ORDER, BAR_CATS, HOOKAH_CATS, STATION_CATS, PERMISSIONS, THEMES, catOf, orderFullyPrepared, canAccess } from "./constants.js";
import { ItemVisual, BottomNav, GlobalStyle, Toast, PWABanner, OrderTimer } from "./uikit.jsx";
import { printOrder, generateReceiptPDF, saveReceiptRecord, saveReceipt } from "./receipts.js";

export function BarTab({store,user,showToast,addNotification,dm,settings}){
  const canDecrease=user.role===ROLES.ADMIN||(settings?.workerCanDecreaseStock??false);
  const barOrders=store.orders.filter(o=>
    ["pending","preparing"].includes(o.status)&&
    o.items.some(i=>BAR_CATS.includes(store.menu.find(m=>m.id===i.itemId)?.category)&&!i.prepared)
  ).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const barItems=store.menu.filter(m=>["hot_drinks","cold_drinks"].includes(m.category));

  const updateStock=(id,delta)=>{
    if(delta<0&&!canDecrease){showToast("غير مسموح بتخفيض المخزون","warn");return}
    store.setMenu(p=>p.map(m=>m.id===id?{...m,stock:Math.max(0,m.stock+delta)}:m));
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
                    <span style={{fontSize:18}}>{i.emoji}</span>
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

export function HookahTab({store,user,showToast,addNotification,dm,settings}){
  const canDecrease=user.role===ROLES.ADMIN||(settings?.workerCanDecreaseStock??false);
  const hookahOrders=store.orders.filter(o=>
    ["pending","preparing"].includes(o.status)&&
    o.items.some(i=>store.menu.find(m=>m.id===i.itemId)?.category==="hookah"&&!i.prepared)
  ).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const hookahItems=store.menu.filter(m=>m.category==="hookah");

  const updateStock=(id,delta)=>{
    if(delta<0&&!canDecrease){showToast("غير مسموح بتخفيض المخزون","warn");return}
    store.setMenu(p=>p.map(m=>m.id===id?{...m,stock:Math.max(0,m.stock+delta)}:m));
  };
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
                    <span>💨</span><span style={{fontWeight:600}}>{i.itemName}</span>
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
