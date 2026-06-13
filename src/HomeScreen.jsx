// الشاشة الرئيسية (موزّع التبويبات) — مفصولة من App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore, checkSessionExpiry, touchSession } from "./lib/store.js";
import { SUPABASE_READY, sbDeleteAll, sbDelete, sbUpsert, sbFetch } from "./lib/supabase.js";
import OutdoorScreen from "./OutdoorScreen.jsx";
import { playOrderAlert, exportToExcel, generateTableQR, checkStockAlerts, notifyLowStock, sendReceiptWhatsApp, printKitchenTicket, getLoyaltyStatus, calcLoyaltyDiscount, getPartialPaymentStatus, getStaffReport, getPeakHoursData, getSalesComparison, calcShiftSummary, getOrderUrgency, getAvgPrepTime, calcEarnedPoints, getCustomerTier, pointsToValue } from "./lib/utils.js";
import { ROLES, ROLE_LABELS, ROLE_COLORS, ORDER_STATUS, STATUS_LABELS, STATUS_COLORS, CAT_LABELS, CAT_ORDER, BAR_CATS, HOOKAH_CATS, STATION_CATS, PERMISSIONS, THEMES, catOf, orderFullyPrepared, canAccess } from "./constants.js";
import { ItemVisual, BottomNav, GlobalStyle, Toast, PWABanner, OrderTimer } from "./uikit.jsx";
import { printOrder, generateReceiptPDF, saveReceiptRecord, saveReceipt } from "./receipts.js";
import { NardeenLogoIcon } from "./NardeenIcons.jsx";
import ActivityLog from "./ActivityLog.jsx";

import { BarTab, HookahTab } from "./StationScreens.jsx";
import { NewOrderTab, OrdersTab, CashierTab, DebtsTab, ExpensesTab } from "./OperationScreens.jsx";
// v23: شاشات الأدمن تُحمَّل كسولاً (chunk منفصل) — يسرّع فتح التطبيق للكاشير والعمال
const lazyAdmin = (name) => React.lazy(() => import("./AdminScreens.jsx").then(m => ({ default: m[name] })));
const DashboardTab    = lazyAdmin("DashboardTab");
const InventoryTab    = lazyAdmin("InventoryTab");
const StockImportTab  = lazyAdmin("StockImportTab");
const MenuTab         = lazyAdmin("MenuTab");
const TablesTab       = lazyAdmin("TablesTab");
const CompLogTab      = lazyAdmin("CompLogTab");
const CustomerFileTab = lazyAdmin("CustomerFileTab");
const ReceiptsTab     = lazyAdmin("ReceiptsTab");
const StaffTab        = lazyAdmin("StaffTab");
const ReportsTab      = lazyAdmin("ReportsTab");
const SettingsTab     = lazyAdmin("SettingsTab");
const OutdoorAdminTab = lazyAdmin("OutdoorAdminTab");
import { KitchenDisplayTab, ShiftCloseTab } from "./Features.jsx";

// ── ErrorBoundary ──────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("[Nardeen] خطأ في التبويب:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: "center", color: "var(--sub)" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>حدث خطأ في هذا التبويب</div>
          <div style={{ fontSize: 12, marginBottom: 16, color: "var(--sub)" }}>
            {this.state.error?.message || ""}
          </div>
          <button
            className="btn btn-red"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            إعادة المحاولة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
// ──────────────────────────────────────────────────────────────────────────────

export function HomeScreen({user,store,onLogout,showToast,addNotification,unreadCount,dm,toggleDark,settings,topOffset=0}){
  const [tab,setTabRaw]=useState(()=>{
    // v31: استعادة آخر تبويب بعد تحديث الصفحة (يبقى في نفس الصفحة)
    try{ const saved=sessionStorage.getItem("nc_active_tab"); if(saved && canAccess(user.role, saved==="inventory"?"dashboard":saved)) return saved; }catch{}
    if(canAccess(user.role,"dashboard")) return "dashboard";
    if(canAccess(user.role,"order")) return "order";
    if(canAccess(user.role,"orders")) return "orders";
    if(canAccess(user.role,"bar")) return "bar";
    if(canAccess(user.role,"hookah")) return "hookah";
    return "orders";
  });
  const setTab=(t)=>{ try{ sessionStorage.setItem("nc_active_tab", typeof t==="function"?t(tab):t); }catch{} setTabRaw(t); };
  const [showNotifs,setShowNotifs]=useState(false);
  const [clock,setClock]=useState(new Date());
  const CUR=settings?.currency||"ل.س";

  useEffect(()=>{
    const t=setInterval(()=>setClock(new Date()),1000);
    return()=>clearInterval(t);
  },[]);

  // ── 5. تنبيه نفاد المخزون ─────────────────────────────────
  const lowStockItems = checkStockAlerts(store.menu);
  const prevLowRef = useRef(0);
  useEffect(()=>{
    if(lowStockItems.length > prevLowRef.current && (user.role==="admin"||user.role==="cashier")){
      notifyLowStock(lowStockItems, settings);
    }
    prevLowRef.current = lowStockItems.length;
  },[lowStockItems.length]);

  const markRead=()=>store.setNotifications(p=>p.map(n=>
    n.targetRoles.includes(user.role)&&!n.read.includes(user.id)?{...n,read:[...n.read,user.id]}:n
  ));

  const navDef=[
    ["dashboard","📊","لوحة التحكم"],
    ["order","➕","طلب جديد"],
    ["orders","📋","الطلبات"],
    ["cashier","💰","الكاشير"],
    ["customers","👥","الزبائن"],
    ["complog","🎁","الضيافة"],
    ["debts","💳","الديون"],
    ["expenses","📒","المصاريف"],
    ["bar","🥤","البار"],
    ["hookah","💨","الأراكيل"],
    ["kds","🖥️","شاشة المطبخ"],
    ["menu","🍽","المنيو"],
    ["stockimport","📦","جرد المخزون"],
    ["tables","🪑","الطاولات"],
    ["shift","🔐","تقفيل الوردية"],
    ["staff","👨‍💼","الموظفون"],
    ["reports","📈","التقارير"],
    ["receipts","🧾","الفواتير"],
    ["settings","⚙","الإعدادات"],
    ["activity","📋","سجل النشاط"],
    ["outdoor_admin","🌿","الحديقة — أدمن"],
  ];
  const navItems=navDef.filter(([t])=>canAccess(user.role,t));

  return(
    <div style={{display:"flex",flexDirection:"column",minHeight:"100vh"}}>
      {/* Header */}
      <header style={{background:"linear-gradient(135deg,#8e0000,#c62828)",color:"#fff",
        padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",
        gap:8,position:"sticky",top:topOffset,zIndex:100,boxShadow:"0 4px 20px rgba(198,40,40,.3)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,borderRadius:"50%",
            background:"rgba(0,0,0,0.2)",border:"1.5px solid rgba(212,160,23,0.4)",
            display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <NardeenLogoIcon size={24} gold="#D4A017" />
          </div>
          <div>
            <div style={{fontWeight:900,fontSize:14,display:"flex",alignItems:"center",gap:6}}>
              {settings?.cafeName||"ناردين كافيه"}
              <span style={{fontSize:9,fontWeight:900,background:"#D4A017",color:"#1a0a00",borderRadius:6,padding:"1px 5px"}}>v31.1</span>
            </div>
            <div style={{fontSize:10,opacity:.8}}>{settings?.signature||"بإدارة يحيى داؤود"}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
          {SUPABASE_READY?(
            <span style={{fontSize:10,background:store.syncing?"rgba(255,193,7,.3)":"rgba(46,125,50,.3)",borderRadius:8,
              padding:"3px 8px",color:store.syncing?"#fff3c4":"#a5d6a7",fontWeight:700,
              animation:store.syncing?"pulse 1.2s infinite":"none"}}>
              {store.syncing?"🔄 تزامن...":"☁ متصل"}
            </span>
          ):(
            <span style={{fontSize:10,background:"rgba(229,57,53,.32)",
              borderRadius:8,padding:"3px 8px",color:"#ffcdd2",fontWeight:800,
              animation:"pulse 2s infinite"}} title="غير متصل بالسحابة — لن تتزامن البيانات بين الأجهزة">⚠ محلي</span>
          )}
          <span className="hide-mobile" style={{fontSize:12,background:"rgba(255,255,255,.15)",
            borderRadius:8,padding:"4px 10px",fontWeight:700}}>
            {clock.toLocaleTimeString("ar-SY",{hour:"2-digit",minute:"2-digit"})}
          </span>
          <button onClick={toggleDark} style={{background:"rgba(255,255,255,.15)",border:"none",
            color:"#fff",borderRadius:10,padding:"6px 10px",fontSize:14}}>
            {dm?"☀":"🌙"}
          </button>
          {lowStockItems.length > 0 && (user.role==="admin"||user.role==="cashier") && (
            <button onClick={()=>setTab("bar")}
              style={{background:"rgba(255,152,0,.3)",border:"none",color:"#ffe082",
                borderRadius:10,padding:"5px 10px",fontSize:12,fontWeight:700,
                animation:"pulse 2s infinite"}}
              title={`${lowStockItems.length} أصناف منخفضة المخزون`}>
              ⚠ {lowStockItems.length}
            </button>
          )}
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
      {/* التنقّل استُبدل بالشريط السفلي اللمسي BottomNav (v8.4) */}

      {/* Content */}
      <main style={{flex:1,padding:16,paddingBottom:96,maxWidth:1280,width:"100%",margin:"0 auto"}}>
        <ErrorBoundary key={tab}>
        <React.Suspense fallback={<div style={{textAlign:"center",padding:40,color:"var(--sub)",fontSize:14}}>⏳ جارٍ التحميل...</div>}>
        {tab==="dashboard"  &&canAccess(user.role,"dashboard") &&<DashboardTab   store={store} dm={dm} settings={settings} key={store.orders.length+"_"+store.orders.filter(o=>o.status==="paid").length}/>}
        {tab==="inventory"  &&canAccess(user.role,"dashboard") &&<InventoryTab   store={store} settings={settings}/>}
        {tab==="order"      &&canAccess(user.role,"order")     &&<NewOrderTab    store={store} user={user} showToast={showToast} addNotification={addNotification} dm={dm} settings={settings}/>}
        {tab==="orders"     &&canAccess(user.role,"orders")    &&<OrdersTab      store={store} user={user} showToast={showToast} addNotification={addNotification} dm={dm} settings={settings}/>}
        {tab==="cashier"    &&canAccess(user.role,"cashier")   &&<CashierTab     store={store} user={user} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="debts"      &&canAccess(user.role,"debts")     &&<DebtsTab       store={store} user={user} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="expenses"   &&canAccess(user.role,"expenses")  &&<ExpensesTab    store={store} user={user} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="bar"        &&canAccess(user.role,"bar")       &&<BarTab         store={store} user={user} showToast={showToast} addNotification={addNotification} dm={dm} settings={settings}/>}
        {tab==="hookah"     &&canAccess(user.role,"hookah")    &&<HookahTab      store={store} user={user} showToast={showToast} addNotification={addNotification} dm={dm} settings={settings}/>}
        {tab==="kds"        &&canAccess(user.role,"kds")       &&<KitchenDisplayTab store={store} user={user} showToast={showToast} addNotification={addNotification} settings={settings}/>}
        {tab==="shift"      &&canAccess(user.role,"shift")     &&<ShiftCloseTab  store={store} user={user} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="menu"       &&canAccess(user.role,"menu")      &&<MenuTab        store={store} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="stockimport"&&canAccess(user.role,"stockimport")&&<StockImportTab store={store} user={user} showToast={showToast} settings={settings}/>}
        {tab==="tables"     &&canAccess(user.role,"tables")    &&<TablesTab      store={store} user={user} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="staff"      &&canAccess(user.role,"staff")     &&<StaffTab       store={store} showToast={showToast} dm={dm}/>}
        {tab==="reports"    &&canAccess(user.role,"reports")   &&<ReportsTab     store={store} dm={dm} settings={settings}/>}
        {tab==="receipts"   &&canAccess(user.role,"receipts")  &&<ReceiptsTab    store={store} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="complog"    &&canAccess(user.role,"complog")   &&<CompLogTab     store={store} user={user} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="customers"  &&canAccess(user.role,"customers") &&<CustomerFileTab store={store} showToast={showToast} dm={dm} settings={settings}/>}
        {tab==="settings"   &&canAccess(user.role,"settings")      &&<SettingsTab    store={store} showToast={showToast} dm={dm} user={user}/>}
        {tab==="activity"   &&canAccess(user.role,"activity")      &&<div className="fade-in" style={{padding:16,maxWidth:720,margin:"0 auto"}}><ActivityLog/></div>}
        {tab==="outdoor_admin"&&canAccess(user.role,"outdoor_admin")&&<OutdoorAdminTab store={store} showToast={showToast} dm={dm} settings={settings} user={user}/>}
        </React.Suspense>
        </ErrorBoundary>
      </main>
      {user.role!=="customer" && <BottomNav navItems={navItems} tab={tab} setTab={setTab} role={user.role}/>}
      <div style={{height:"env(safe-area-inset-bottom,0px)"}}/>
    </div>
  );
}

// ═══════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════
