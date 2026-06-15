// شاشات التشغيل (طلبات/كاشير/ديون/مصاريف) — مفصولة من App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useStore, checkSessionExpiry, touchSession, getNextInvoiceNum } from "./lib/store.js";
import { SUPABASE_READY, sbDeleteAll, sbDelete, sbUpsert, sbFetch, logActivity } from "./lib/supabase.js";
import OutdoorScreen from "./OutdoorScreen.jsx";
import { playOrderAlert, exportToExcel, generateTableQR, checkStockAlerts, notifyLowStock, sendReceiptWhatsApp, printKitchenTicket, getLoyaltyStatus, calcLoyaltyDiscount, getPartialPaymentStatus, getStaffReport, getPeakHoursData, getSalesComparison, calcShiftSummary, getOrderUrgency, getAvgPrepTime, calcEarnedPoints, getCustomerTier, pointsToValue, calcNetProfit, businessDayStart } from "./lib/utils.js";
import { ROLES, ROLE_LABELS, ROLE_COLORS, ORDER_STATUS, STATUS_LABELS, STATUS_COLORS, CAT_LABELS, CAT_ORDER, BAR_CATS, HOOKAH_CATS, STATION_CATS, PERMISSIONS, THEMES, catOf, orderFullyPrepared, canAccess } from "./constants.js";
import { deductOrderStock, restoreOrderStock, isStockDeducted } from "./lib/stock.js";
import { ItemVisual, BottomNav, GlobalStyle, Toast, PWABanner, OrderTimer, CancelOrderModal } from "./uikit.jsx";
import { printOrder, generateReceiptPDF, saveReceiptRecord, saveReceipt, generateZReportPDF } from "./receipts.js";
import { notifyTelegram, buildEventMsg } from "./lib/telegram.js";

export function NewOrderTab({store,user,showToast,addNotification,dm,settings}){
  const [cart,setCart]=useState([]);
  const [specialModal,setSpecialModal]=useState(null); // v24: {item, name, price, cost}
  const [search,setSearch]=useState("");
  const [cat,setCat]=useState("all");
  const [tableNum,setTableNum]=useState("");
  const [notes,setNotes]=useState("");
  const [customerName,setCustomerName]=useState("");
  const [discount,setDiscount]=useState(0);
  const [submitting,setSubmitting]=useState(false);
  const [printAsk,setPrintAsk]=useState(null); // v26: {order,orderNum} مودال طباعة الفاتورة
  const [sheetOpen,setSheetOpen]=useState(false); // v27: السلة المنزلقة على الموبايل
  const [barHidden,setBarHidden]=useState(false);  // v27.2: إخفاء الشريط المصغّر بالسحب لأسفل
  const dragRef=useRef({startY:0,dy:0,dragging:false});
  const [dragY,setDragY]=useState(0);
  // v27.2: يعود الشريط للظهور تلقائياً عند إضافة صنف جديد للسلة
  const prevCount=useRef(0);
  const [orderMode,setOrderMode]=useState("new"); // "new" | "addto"
  const [targetOrderId,setTargetOrderId]=useState(""); // للإضافة لطلب موجود
  const [tableError,setTableError]=useState("");
  const CUR=settings?.currency||"ل.س";
  const maxDiscount=settings?.maxDiscount??50;
  const isAdmin=user.role===ROLES.ADMIN;

  // الطلبات النشطة الصالحة للإضافة
  const activeOrders=store.orders.filter(o=>!["paid","cancelled","complimentary"].includes(o.status));

  const filtered=store.menu.filter(m=>{
    const ms=m.name.toLowerCase().includes(search.toLowerCase())||(m.nameEn||"").toLowerCase().includes(search.toLowerCase());
    const mc=cat==="all"||m.category===cat;
    return ms&&mc&&(m.noStock||m.trackStock===false||m.stock>0); // v24 خدمي / v28 مفتوح: يظهر دائماً
  });

  const addToCart=(item)=>{
    // v24: الأصناف الخدمية تفتح مودال لإدخال السعر (والاسم/التكلفة للطلب الخاص)
    if(item.isSession||item.isCustom){
      setSpecialModal({ item, name:item.isCustom?"":item.name, price:"", cost:"" });
      return;
    }
    setCart(p=>{
      const ex=p.find(c=>c.itemId===item.id);
      if(ex) return p.map(c=>c.itemId===item.id?{...c,qty:c.qty+1}:c);
      return [...p,{itemId:item.id,itemName:item.name,price:item.price,qty:1,emoji:item.emoji}];
    });
  };
  // v24: تأكيد صنف خاص → يُضاف للسلة كسطر مستقل (qty=1، سعر وتكلفة مخصصان)
  const confirmSpecial=()=>{
    const m=specialModal; if(!m) return;
    const price=Math.round(+m.price||0);
    const cost=Math.round(+m.cost||0);
    const nm=(m.name||"").trim()||m.item.name;
    if(price<=0){ showToast("أدخل سعراً صحيحاً","error"); return; }
    if(m.item.isCustom && cost<=0){ showToast("أدخل تكلفة الشراء","error"); return; }
    setCart(p=>[...p,{
      itemId:m.item.id, itemName:nm, price, qty:1, emoji:m.item.emoji,
      special:m.item.isCustom?"custom":"session",
      customCost: m.item.isCustom?cost:0,
      lineId:"sp_"+Date.now()+Math.random().toString(36).slice(2,6), // سطر فريد
    }]);
    setSpecialModal(null);
  };
  const lineKey=(c)=>c.lineId||c.itemId;
  const removeLine=(c)=>setCart(p=>{
    const ex=p.find(x=>lineKey(x)===lineKey(c));
    if(ex&&!ex.special&&ex.qty>1) return p.map(x=>lineKey(x)===lineKey(c)?{...x,qty:x.qty-1}:x);
    return p.filter(x=>lineKey(x)!==lineKey(c)); // الأصناف الخاصة تُحذف كاملة
  });
  const incLine=(c)=>{
    if(c.special) return; // لا تكرار للأصناف الخاصة (كل سطر فريد)
    setCart(p=>p.map(x=>lineKey(x)===lineKey(c)?{...x,qty:x.qty+1}:x));
  };
  const setItemNote=(key,note)=>setCart(p=>p.map(c=>lineKey(c)===key?{...c,note}:c));

  // v27: الطلبات السريعة الذكية — تترتب تلقائياً حسب تراكم المبيعات (totalSold)
  const quickItems=useMemo(()=>(store.menu||[])
    .filter(m=>m.active!==false && !m.noStock && (m.noStock||m.stock>0) && (m.totalSold||0)>0)
    .sort((a,b)=>(b.totalSold||0)-(a.totalSold||0))
    .slice(0,6),[store.menu]);
  const cartTotal=cart.reduce((s,c)=>s+c.price*c.qty,0);
  const cartCount=cart.reduce((s,c)=>s+c.qty,0);
  // v27.2: يعود الشريط للظهور تلقائياً عند إضافة صنف جديد للسلة
  useEffect(()=>{ if(cartCount>prevCount.current) setBarHidden(false); prevCount.current=cartCount; },[cartCount]);
  const discountAmt=Math.round(cartTotal*Math.min(discount,maxDiscount)/100);
  const finalTotal=cartTotal-discountAmt;

  const placeOrder=()=>{
    setTableError("");
    // v30.3: إلزام الكاشير بفتح وردية قبل الطلبات (الأدمن معفى) — لا يشمل الحديقة
    if(user.role!=="admin"){
      const openShift=(store.shifts||[]).find(s=>s.status==="open" && (s.branch||"main")==="main");
      if(!openShift){ showToast("⚠ لا توجد وردية مفتوحة — اطلب من الكاشير فتح وردية أولاً","error"); return; }
    }
    if(!cart.length){showToast("السلة فارغة","error");return}
    if(!tableNum.trim()){setTableError("⚠ رقم الطاولة مطلوب");return}

    if(orderMode==="addto"){
      // إضافة لطلب موجود
      if(!targetOrderId){showToast("⚠ اختر الطلب المراد الإضافة إليه","error");return}
      const target=store.orders.find(o=>o.id===targetOrderId);
      if(!target){showToast("الطلب غير موجود","error");return}
      const mergedItems=[...target.items];
      cart.forEach(ci=>{
        const ex=mergedItems.find(i=>i.itemId===ci.itemId);
        if(ex){ ex.qty+=ci.qty; if(ci.note) ex.note=ci.note; }
        else mergedItems.push({...ci});
      });
      const newTotal=mergedItems.reduce((s,i)=>s+i.price*i.qty,0);
      store.setOrders(p=>p.map(o=>o.id===targetOrderId?{...o,items:mergedItems,total:newTotal,status:"pending"}:o));
      // v23: إن كان الطلب الهدف من النظام القديم (مخصوم) نخصم الإضافات فوراً؛
      // وإن كان v23 (غير مخصوم) فلا خصم الآن — يُخصم كاملاً عند الدفع.
      if (isStockDeducted(target)) {
        store.setMenu(p=>p.map(m=>{
          const ci=cart.find(c=>c.itemId===m.id);
          if(!ci) return m;
          return{...m,stock:Math.max(0,m.stock-ci.qty),totalSold:m.totalSold+ci.qty};
        }));
      }
      const hasDrinks=cart.some(c=>["hot_drinks","cold_drinks"].includes(store.menu.find(m=>m.id===c.itemId)?.category));
      const hasHookah=cart.some(c=>store.menu.find(m=>m.id===c.itemId)?.category==="hookah");
      if(hasDrinks) addNotification(`🍹 إضافة للطلب #${target.orderNum} — البار`,[ROLES.BAR],targetOrderId);
      if(hasHookah) addNotification(`💨 إضافة للطلب #${target.orderNum} — أراكيل`,[ROLES.HOOKAH],targetOrderId);
      addNotification(`📋 تم إضافة أصناف للطلب #${target.orderNum}`,[ROLES.CASHIER,ROLES.ADMIN],targetOrderId);
      setCart([]);setTableNum("");setNotes("");setCustomerName("");setDiscount(0);setTargetOrderId("");setSheetOpen(false);
      showToast(`✓ تم الإضافة للطلب #${target.orderNum}`);
      return;
    }

    setSubmitting(true);
    setTimeout(async ()=>{
      const orderNum=await getNextInvoiceNum(store.orders); // v29: متسلسل يُصفّر يومياً (YYYYMMDD-NNN)
      const newOrder={
        id:(Date.now().toString(36)+Math.random().toString(36).slice(2,7)),orderNum,
        customerId:user.id,customerName:customerName||user.name,
        workerName:user.name,table:tableNum.trim(),notes,items:cart,
        total:finalTotal,originalTotal:cartTotal,discount,
        paymentType:"cash",
        status:ORDER_STATUS.PENDING,
        createdAt:new Date().toISOString(),paymentStatus:"pending",
        stockDeducted:false, // v23: الخصم عند الدفع لا عند الإنشاء
      };
      store.setOrders(p=>[newOrder,...p]);
      logActivity({ action: "إنشاء طلب", details: `${cart.length} صنف${tableNum.trim() ? ` — طاولة ${tableNum.trim()}` : ""}`, userName: user.name, userRole: user.role, orderNum, amount: finalTotal, branch: "main" });
      // إضافة الزبون لملف الزبائن — store.setCustomers يتولى المزامنة مع Supabase تلقائياً
      if(customerName.trim()){
        store.setCustomers(p=>{
          const ex=p.find(c=>c.name===customerName.trim());
          if(ex){
            const updated={
              ...ex,
              visits:(ex.visits||0)+1,
              totalOrders:(ex.totalOrders||0)+1,
              totalSpent:(ex.totalSpent||0), // v31.4: الإنفاق يُحتسب عند الدفع لا الإنشاء (دقّة الطبقة)
              lastVisit:new Date().toISOString(),
              orders:[newOrder.id,...(ex.orders||[])],
            };
            return p.map(c=>c.name===customerName.trim()?updated:c);
          }
          return [{
            id:"cust_"+Date.now(),
            name:customerName.trim(),
            visits:1,
            totalOrders:1,
            totalSpent:0, // v31.4: يُحتسب عند الدفع
            lastVisit:new Date().toISOString(),
            createdAt:new Date().toISOString(),
            orders:[newOrder.id],
            phone:"",email:"",notes:"",
          },...p];
        });
      }

      const hasDrinks=cart.some(c=>["hot_drinks","cold_drinks"].includes(store.menu.find(m=>m.id===c.itemId)?.category));
      const hasHookah=cart.some(c=>store.menu.find(m=>m.id===c.itemId)?.category==="hookah");
      if(hasDrinks) addNotification(`🍹 طلب #${orderNum} للبار${tableNum?` • طاولة ${tableNum}`:""}`, [ROLES.BAR],newOrder.id);
      if(hasHookah) addNotification(`💨 طلب نرجيلة #${orderNum}${tableNum?` • طاولة ${tableNum}`:""}`, [ROLES.HOOKAH],newOrder.id);
      addNotification(`📋 طلب جديد #${orderNum} من ${newOrder.customerName}`,[ROLES.CASHIER,ROLES.ADMIN],newOrder.id);
      // تحديث حالة الطاولة
      store.setTables(p=>p.map(t=>String(t.number)===String(tableNum.trim())?{...t,status:"occupied",openedAt:t.openedAt||new Date().toISOString()}:t));
      setCart([]);setTableNum("");setNotes("");setCustomerName("");setDiscount(0);setSheetOpen(false);
      setSubmitting(false);
      // ✅ الفاتورة تُحفظ فقط عند الدفع في CashierTab — لا تُحفظ هنا
      showToast(`تم تسجيل الطلب #${orderNum} ✓`);
      setPrintAsk({ order: newOrder, orderNum }); // v26: مودال طباعة بدل window.confirm المعطّل في WebView
    },800);
  };

  return(
    <>
    {printAsk&&(
      <div onClick={e=>{if(e.target===e.currentTarget)setPrintAsk(null);}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
        <div onClick={e=>e.stopPropagation()} className="card fade-in" style={{width:"100%",maxWidth:320}}>
          <div style={{fontWeight:900,fontSize:16,marginBottom:6}}>🖨️ طباعة الفاتورة؟</div>
          <div style={{fontSize:12,color:"var(--sub)",marginBottom:14}}>الطلب #{printAsk.orderNum}</div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setPrintAsk(null)} style={{flex:1,background:"var(--card2)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:10,padding:"11px",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>لاحقاً</button>
            <button onClick={()=>{const o=printAsk.order;printOrder(o,store.menu,1,settings);setTimeout(()=>printOrder(o,store.menu,2,settings),800);setPrintAsk(null);}} style={{flex:2,background:"#1565c0",color:"#fff",border:"none",borderRadius:10,padding:"11px",fontWeight:900,cursor:"pointer",fontFamily:"inherit"}}>🖨️ طباعة</button>
          </div>
        </div>
      </div>
    )}
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
        {quickItems.length>0 && cat==="all" && !search && (
          <div className="card" style={{padding:"10px 12px"}}>
            <div style={{fontSize:11,fontWeight:800,color:"var(--sub)",marginBottom:8,display:"flex",alignItems:"center",gap:5}}>
              ⚡ الأكثر طلباً <span style={{fontSize:9,fontWeight:600,opacity:.7}}>(يترتّب تلقائياً)</span>
            </div>
            <div style={{display:"flex",gap:8,overflowX:"auto"}} className="scroll-hide">
              {quickItems.map((item,i)=>(
                <button key={item.id} onClick={()=>addToCart(item)}
                  style={{flexShrink:0,display:"flex",alignItems:"center",gap:6,padding:"8px 12px",borderRadius:12,border:"1.5px solid var(--border)",
                    background:i===0?"linear-gradient(135deg,#f9a825,#f57f17)":"var(--card2)",color:i===0?"#fff":"var(--text)",
                    fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                  <span style={{fontSize:16}}>{item.emoji||"🍽"}</span>
                  {item.name}
                  {i===0&&<span style={{fontSize:9,background:"rgba(255,255,255,.3)",borderRadius:8,padding:"1px 5px"}}>الأعلى</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{flex:1,overflowY:"auto",display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(135px,1fr))",gap:8,paddingBottom:10}} className="scroll-hide">
          {filtered.map(item=>{
            const inCart=cart.find(c=>c.itemId===item.id);
            return(
              <div key={item.id} onClick={()=>addToCart(item)}
                style={{background:"var(--card)",borderRadius:12,padding:12,cursor:"pointer",
                  transition:"all .2s",boxShadow:inCart?"0 0 0 2px #c62828,var(--shadow)":"var(--shadow)",
                  transform:inCart?"scale(1.03)":"scale(1)",position:"relative",userSelect:"none"}}>
                <div style={{textAlign:"center",marginBottom:5}}><ItemVisual item={item} size={54} round={12}/></div>
                <div style={{fontSize:11,fontWeight:700,textAlign:"center",marginBottom:3,lineHeight:1.3}}>{item.name}</div>
                <div style={{fontSize:11,fontWeight:900,color:"#c62828",textAlign:"center"}}>{item.price.toLocaleString()} {CUR}</div>
                {item.trackStock!==false && !item.noStock && (
                  <div style={{fontSize:9,color:(item.stock||0)<1?"#ff9800":"var(--sub)",textAlign:"center",marginTop:2}}>
                    مخزون: {item.stock}
                  </div>
                )}
                {inCart&&<div style={{position:"absolute",top:6,left:6,background:"#c62828",color:"#fff",
                  borderRadius:"50%",width:20,height:20,fontSize:11,fontWeight:900,
                  display:"flex",alignItems:"center",justifyContent:"center"}}>{inCart.qty}</div>}
              </div>
            );
          })}
          {filtered.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:40,color:"var(--sub)"}}>لا توجد أصناف</div>}
        </div>
      </div>

      {/* خلفية معتمة خلف اللوحة المنزلقة (موبايل فقط) */}
      {sheetOpen&&<div className="sheet-overlay show-mobile-only" onClick={()=>setSheetOpen(false)}/>}

      {/* شريط السلة المصغّر — يظهر فقط حين فيه أصناف، قابل للسحب لأسفل ليختفي */}
      {!barHidden && cartCount>0 && (
      <div className="cart-minibar show-mobile-only"
        style={{transform:dragY>0?`translateY(${dragY}px)`:undefined,transition:dragRef.current.dragging?"none":"transform .25s"}}
        onClick={()=>{ if(Math.abs(dragRef.current.dy)<6) setSheetOpen(true); }}
        onTouchStart={e=>{dragRef.current={startY:e.touches[0].clientY,dy:0,dragging:true};}}
        onTouchMove={e=>{ if(!dragRef.current.dragging)return; const d=e.touches[0].clientY-dragRef.current.startY; dragRef.current.dy=d; if(d>0)setDragY(d); }}
        onTouchEnd={()=>{ const d=dragRef.current.dy; dragRef.current.dragging=false; if(d>50){ setBarHidden(true); } setDragY(0); }}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:20}}>🛒</span>
          <div style={{display:"flex",flexDirection:"column",lineHeight:1.2}}>
            <span style={{fontWeight:900,fontSize:14}}>{cartCount} صنف</span>
            <span style={{fontSize:12,opacity:.9}}>{cartTotal.toLocaleString()} {CUR}</span>
          </div>
        </div>
        <span style={{background:"rgba(255,255,255,.25)",borderRadius:10,padding:"8px 16px",fontWeight:900,fontSize:13}}>
          عرض وتسجيل ↑
        </span>
      </div>
      )}
      {/* زر صغير لإعادة إظهار الشريط بعد إخفائه (يظهر فقط حين فيه أصناف) */}
      {barHidden && cartCount>0 && (
        <button className="show-mobile-only" onClick={()=>setBarHidden(false)}
          style={{position:"fixed",insetInlineEnd:14,bottom:14,zIndex:1400,width:54,height:54,borderRadius:"50%",border:"none",
            background:"linear-gradient(135deg,#c62828,#8e0000)",color:"#fff",fontSize:22,cursor:"pointer",
            boxShadow:"0 4px 16px rgba(0,0,0,.35)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          🛒<span style={{position:"absolute",top:-2,insetInlineStart:-2,background:"#f9a825",color:"#1a0a00",borderRadius:"50%",minWidth:22,height:22,fontSize:12,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 4px"}}>{cartCount}</span>
        </button>
      )}

      {/* Cart */}
      <div className={"order-cart"+(sheetOpen?" sheet-open":"")} style={{background:"var(--card)",borderRadius:16,boxShadow:"var(--shadow)",
        display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* مقبض السحب + إغلاق (موبايل) */}
        <div className="sheet-handle show-mobile-only" onClick={()=>setSheetOpen(false)}>
          <div className="sheet-grip"/>
          <button onClick={(e)=>{e.stopPropagation();setSheetOpen(false);}} style={{position:"absolute",insetInlineEnd:14,top:10,background:"rgba(0,0,0,.08)",border:"none",borderRadius:8,width:30,height:30,fontSize:16,cursor:"pointer",color:"var(--text)"}}>✕</button>
        </div>
        <div style={{padding:"14px 14px 10px",background:"linear-gradient(135deg,#c62828,#8e0000)"}}>
          <div style={{color:"#fff",fontWeight:900,fontSize:15}}>
            🛒 السلة {cartCount>0&&<span style={{background:"rgba(255,255,255,.3)",borderRadius:20,padding:"2px 8px",fontSize:12}}>{cartCount}</span>}
          </div>
        </div>
        {/* وضع الطلب */}
        <div style={{padding:"10px 12px",borderBottom:"1px solid var(--border)",display:"flex",gap:6}}>
          <button onClick={()=>setOrderMode("new")}
            style={{flex:1,padding:"8px 4px",borderRadius:10,border:"none",fontWeight:700,fontSize:12,cursor:"pointer",
              background:orderMode==="new"?"#c62828":"var(--card2)",color:orderMode==="new"?"#fff":"var(--sub)"}}>
            ➕ طلب جديد
          </button>
          <button onClick={()=>setOrderMode("addto")}
            style={{flex:1,padding:"8px 4px",borderRadius:10,border:"none",fontWeight:700,fontSize:12,cursor:"pointer",
              background:orderMode==="addto"?"#1565c0":"var(--card2)",color:orderMode==="addto"?"#fff":"var(--sub)"}}>
            📋 إضافة لطلب
          </button>
        </div>
        <div style={{padding:"10px 12px",borderBottom:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:8}}>
          {orderMode==="addto"&&(
            <select className="input" value={targetOrderId} onChange={e=>setTargetOrderId(e.target.value)} style={{fontSize:13}}>
              <option value="">— اختر الطلب —</option>
              {activeOrders.map(o=>(
                <option key={o.id} value={o.id}>#{o.orderNum} — {o.customerName} • ط{o.table}</option>
              ))}
            </select>
          )}
          <div>
            <input className="input" placeholder="🪑 رقم الطاولة *" value={tableNum} onChange={e=>{setTableNum(e.target.value);setTableError("");}}
              style={{fontSize:13,border:tableError?"2px solid #c62828":undefined}}/>
            {tableError&&<div style={{color:"#c62828",fontSize:11,marginTop:3,fontWeight:700}}>{tableError}</div>}
          </div>
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
            <div key={lineKey(item)} style={{padding:"7px 0",borderBottom:"1px solid var(--border)"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <ItemVisual item={store.menu.find(m=>m.id===item.itemId)||item} size={34} round={8}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600}}>{item.itemName}{item.special==="custom"?<span style={{fontSize:10,color:"#e65100",marginInlineStart:4}}>🛒 خاص</span>:item.special==="session"?<span style={{fontSize:10,color:"#6a1b9a",marginInlineStart:4}}>🎟️</span>:null}</div>
                  <div style={{fontSize:11,color:"#c62828",fontWeight:700}}>{(item.price*item.qty).toLocaleString()} {CUR}{item.special==="custom"&&item.customCost?<span style={{color:"var(--sub)",fontWeight:400}}> · تكلفة {item.customCost.toLocaleString()}</span>:null}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6,background:"var(--card2)",borderRadius:20,padding:"3px 8px"}}>
                  <button onClick={()=>removeLine(item)} style={{background:"none",border:"none",fontSize:15,color:"#c62828",fontWeight:900,lineHeight:1}}>−</button>
                  <span style={{fontWeight:900,fontSize:13,minWidth:18,textAlign:"center"}}>{item.qty}</span>
                  <button onClick={()=>incLine(item)} disabled={item.special} style={{background:"none",border:"none",fontSize:15,color:item.special?"var(--sub)":"#2e7d32",fontWeight:900,lineHeight:1,opacity:item.special?.4:1}}>+</button>
                </div>
              </div>
              <input value={item.note||""} onChange={e=>setItemNote(lineKey(item),e.target.value)}
                placeholder="📝 ملاحظة (مثال: بدون سكر، إكسترا...)"
                style={{width:"100%",marginTop:5,padding:"5px 8px",fontSize:11,borderRadius:7,
                  border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text)",fontFamily:"'Tajawal',sans-serif"}}/>
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

      {/* v24: مودال الصنف الخاص — رسم جلسة / طلب خاص */}
      {specialModal&&(
        <div onClick={()=>setSpecialModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"var(--card)",borderRadius:16,padding:20,width:"100%",maxWidth:360}}>
            <div style={{fontSize:16,fontWeight:900,marginBottom:4}}>
              {specialModal.item.isCustom?"🛒 طلب خاص (شراء وبيع)":"🎟️ رسم جلسة / دراسة"}
            </div>
            <div style={{fontSize:12,color:"var(--sub)",marginBottom:14}}>
              {specialModal.item.isCustom
                ?"مادة تُشترى للزبون — تُسجَّل تكلفتها كمصروف تلقائياً عند الدفع"
                :"السعر يحدده الكاشير حسب عدد الطلاب ومدة الجلسة"}
            </div>

            {specialModal.item.isCustom&&(
              <div style={{marginBottom:10}}>
                <label style={{fontSize:12,fontWeight:700,display:"block",marginBottom:4}}>اسم المادة</label>
                <input className="input" autoFocus placeholder="مثال: ببسي كبير، عصير معلّب..."
                  value={specialModal.name} onChange={e=>setSpecialModal({...specialModal,name:e.target.value})}
                  style={{fontSize:14}}/>
              </div>
            )}

            <div style={{display:"flex",gap:10,marginBottom:specialModal.item.isCustom?10:16}}>
              <div style={{flex:1}}>
                <label style={{fontSize:12,fontWeight:700,display:"block",marginBottom:4}}>سعر البيع ({CUR})</label>
                <input className="input" type="number" min="0" inputMode="numeric"
                  autoFocus={!specialModal.item.isCustom}
                  value={specialModal.price} onChange={e=>setSpecialModal({...specialModal,price:e.target.value})}
                  style={{fontSize:15,fontWeight:700}}/>
              </div>
              {specialModal.item.isCustom&&(
                <div style={{flex:1}}>
                  <label style={{fontSize:12,fontWeight:700,display:"block",marginBottom:4,color:"#e65100"}}>تكلفة الشراء ({CUR})</label>
                  <input className="input" type="number" min="0" inputMode="numeric"
                    value={specialModal.cost} onChange={e=>setSpecialModal({...specialModal,cost:e.target.value})}
                    style={{fontSize:15,fontWeight:700}}/>
                </div>
              )}
            </div>

            {specialModal.item.isCustom&&(+specialModal.price>0)&&(+specialModal.cost>0)&&(
              <div style={{fontSize:12,fontWeight:700,color:"#2e7d32",marginBottom:14,textAlign:"center",background:"#e8f5e9",borderRadius:8,padding:"6px"}}>
                الربح المتوقع: {(Math.round(+specialModal.price)-Math.round(+specialModal.cost)).toLocaleString()} {CUR}
              </div>
            )}

            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setSpecialModal(null)}
                style={{flex:1,background:"var(--card2)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:10,padding:"11px",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                إلغاء
              </button>
              <button onClick={confirmSpecial}
                style={{flex:2,background:"#c62828",color:"#fff",border:"none",borderRadius:10,padding:"11px",fontWeight:900,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>
                ✓ إضافة للسلة
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </>
  );
}

// ═══════════════════════════════════
// ORDERS TAB — with edit order feature
// ═══════════════════════════════════

export function OrdersTab({store,user,showToast,addNotification,dm,settings}){
  const [filter,setFilter]=useState("active");
  const [search,setSearch]=useState("");
  const [editOrder,setEditOrder]=useState(null);
  const [cancelModal,setCancelModal]=useState(null); // v26: {order} تأكيد إلغاء الطلب
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
    store.setOrders(p=>p.map(o=>{
      if(o.id!==order.id) return o;
      if(newStatus==="ready") return {...o,status:"ready",readyAt:new Date().toISOString(),items:o.items.map(i=>({...i,prepared:true}))};
      if(newStatus==="preparing") return {...o,status:"preparing",preparingAt:o.preparingAt||new Date().toISOString()};
      return {...o,status:newStatus};
    }));
    if(newStatus==="ready") addNotification(`✅ طلب #${order.orderNum} جاهز`,[ROLES.CASHIER,ROLES.ADMIN,ROLES.WORKER],order.id);
    showToast(`تم تحديث الطلب #${order.orderNum}`);
  };
  const cancelOrder=(order,reason="")=>{
    store.setOrders(p=>p.map(o=>o.id===order.id?{...o,status:"cancelled",cancelReason:reason||""}:o));
    restoreOrderStock(store, order); // v23: يُرجع فقط إن كان قد خُصم
    logActivity({ action: "إلغاء طلب", details: reason||"بلا سبب", userName: user.name, userRole: user.role, orderNum: order.orderNum, amount: order.total, branch: order.branch || "main" });
    // v27: تنبيه تليجرام صامت
    notifyTelegram(settings?.telegramTargets||[], "cancel", buildEventMsg("cancel", { orderNum: order.orderNum, customerName: order.customerName, amount: order.total, reason: reason||"بلا سبب", by: user.name }, settings?.cafeName||"ناردين كافيه", settings?.currency||"ل.س"));
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
              <ItemVisual item={store.menu.find(m=>m.id===item.itemId)||item} size={30} round={8}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600}}>{item.itemName}</div>
                {item.note&&<div style={{fontSize:10,color:"#c62828",fontWeight:700}}>📝 {item.note}</div>}
              </div>
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
      {cancelModal&&<CancelOrderModal order={cancelModal.order} cur={settings?.currency||"ل.س"}
        onConfirm={(reason)=>{cancelOrder(cancelModal.order,reason);setCancelModal(null);}}
        onClose={()=>setCancelModal(null)}/>}
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
                    <span style={{display:"inline-flex",alignItems:"center",gap:6}}><ItemVisual item={store.menu.find(m=>m.id===item.itemId)||item} size={22} round={6}/>{item.itemName} ×{item.qty}{item.note?<span style={{color:"#c62828",fontWeight:700,marginInlineStart:4}}>📝{item.note}</span>:""}</span>
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
                    <button onClick={()=>setCancelModal({order})}
                      style={{background:"rgba(198,40,40,.15)",border:"none",borderRadius:8,padding:"8px 10px",fontSize:13,color:"#c62828"}}>
                      🚫
                    </button>
                  </>
                )}
                <button onClick={()=>printOrder(order,store.menu,2,settings)}
                  style={{background:"var(--card2)",border:"none",borderRadius:8,padding:"8px 10px",fontSize:14}}>
                  🖨
                </button>
                {["ready","paid"].includes(order.status)&&(
                  <button onClick={()=>sendReceiptWhatsApp(order, order.customerPhone||"", settings)}
                    style={{background:"rgba(37,211,102,.15)",border:"none",borderRadius:8,
                      padding:"8px 10px",fontSize:14,color:"#2e7d32"}}
                    title="إرسال الفاتورة واتساب">
                    💬
                  </button>
                )}
                {["pending","preparing"].includes(order.status)&&canManage&&(
                  <button onClick={()=>printKitchenTicket(order,"bar",settings)}
                    style={{background:"rgba(21,101,192,.1)",border:"none",borderRadius:8,
                      padding:"8px 10px",fontSize:14,color:"#1565c0"}}
                    title="طباعة تذكرة البار">
                    🍹
                  </button>
                )}
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

export function CashierTab({ store, user, showToast, dm, settings }) {
  const CUR = settings?.currency || "ل.س";
  const maxDiscount = settings?.maxDiscount ?? 50;
  const isAdmin = user?.role === "admin";
  const today = useMemo(() => businessDayStart(), []);
  const todayRevenue = useMemo(() =>
    store.orders.filter(o => o.status === "paid" && new Date(o.paidAt || o.createdAt) >= today).reduce((s, o) => s + o.total, 0)
    , [store.orders, today]);
  const readyOrders = useMemo(() => store.orders.filter(o => o.status === "ready"), [store.orders]);
  const todayExpenses = useMemo(() =>
    (store.expenses || []).filter(e => !e.isSecondary && !e.isComplimentary && new Date(e.date) >= today).reduce((s, e) => s + e.amount, 0)
    , [store.expenses, today]);
  const tronToday = useMemo(() =>
    (store.receipts || []).filter(r => r.tronAmount > 0 && new Date(r.createdAt) >= today).reduce((s, r) => s + r.tronAmount, 0)
    , [store.receipts, today]);
  const dailyInventory = todayRevenue - todayExpenses + tronToday;
  const todayProfit = useMemo(() => calcNetProfit(store.orders, store.menu, today), [store.orders, store.menu, today]);

  const [customerFilter, setCustomerFilter] = useState("");
  const [discounts, setDiscounts] = useState({});      // الخصم المُثبَّت (مبلغ ثابت) المؤثّر في الإجمالي
  const [discInput, setDiscInput] = useState({});      // v31.5: المبلغ المُدخَل قبل التثبيت
  const [discConfirm, setDiscConfirm] = useState(null); // {orderId, amount} نافذة تأكيد التثبيت
  const [cashConfirm, setCashConfirm] = useState(null); // v31.6: تأكيد الدفع النقدي
  const [tronAmounts, setTronAmounts] = useState({});
  const [debtModal, setDebtModal] = useState(null);
  const [debtNameInput, setDebtNameInput] = useState("");
  const [debtNameError, setDebtNameError] = useState("");
  const [debtMergeMode, setDebtMergeMode] = useState(false);
  const [debtMergeName, setDebtMergeName] = useState("");
  const [compModal, setCompModal] = useState(null);
  const [compItems, setCompItems] = useState([]);
  const [workerModal, setWorkerModal] = useState(null); // v31.4: مشروب عامل
  const [workerName, setWorkerName] = useState("");
  const [tronModal, setTronModal] = useState(null);
  const [tronInput, setTronInput] = useState("");
  const [partialModal, setPartialModal] = useState(null);
  const [partialInput, setPartialInput] = useState("");
  const [payingId, setPayingId] = useState(null); // v22: قفل الدفع المزدوج + حالة التحميل

  const filteredReady = readyOrders.filter(o =>
    !customerFilter || (o.customerName || "").includes(customerFilter)
  );

  const autoFreeTable = (tableNum, updatedOrders) => {
    if (!tableNum) return;
    const remaining = updatedOrders.filter(o =>
      String(o.table) === String(tableNum) &&
      !["paid", "cancelled", "debt", "complimentary"].includes(o.status)
    );
    if (remaining.length === 0) {
      store.setTables(p => p.map(t =>
        String(t.number) === String(tableNum) ? { ...t, status: "free", openedAt: null } : t
      ));
    }
  };

  const markPaid = async (order, payType = "cash") => {
    // v22: حمايات الدفع — منع النقر المزدوج + رفض الدفع دون اتصال
    if (payingId) return;
    // v32: لم يَعُد الدفع يُجهض عند انقطاع الشبكة — يُحفظ محليًا ويُزامن لاحقًا (انظر payOrder)
    const cur = store.orders.find(o => o.id === order.id);
    if (cur && !["ready", "preparing", "pending"].includes(cur.status)) {
      showToast("⚠ الطلب لم يعد متاحًا للدفع (رُبّما عولج من جهاز آخر)", "warn");
      return;
    }
    const disc = discounts[order.id] || 0;
    const discAmt = Math.min(Math.max(0, disc), order.total); // v31.5: مبلغ ثابت
    const finalTotal = order.total - discAmt;
    const tronAmt = tronAmounts[order.id] || 0;
    const openShift = (store.shifts || []).find(s => s.status === "open" && s.branch === (order.branch || "main"));
    const paid = {
      ...order, status: "paid", paymentStatus: "paid",
      paymentType: payType,
      paidAt: new Date().toISOString(), paidBy: user.id, paidByName: user.name,
      discount: disc, originalTotal: order.total, total: finalTotal,
      shiftId: openShift?.id || order.shiftId || null,
      stockDeducted: true, // v23: يُخصم الآن عند الدفع
    };
    const cashEntry = {
      id: "cash_pay_" + order.id, orderId: order.id, orderNum: order.orderNum, // v33: حتمي => دفع مزدوج لا يضاعف النقد
      amount: finalTotal, at: new Date().toISOString(), by: user.name,
      type: payType === "tron" ? "tron" : "sale",
      branch: order.branch || "main", shiftId: openShift?.id || null,
    };
    const updated = store.orders.map(o => o.id === order.id ? paid : o);
    const shouldFreeTable = !!order.table && updated.filter(o =>
      String(o.table) === String(order.table) &&
      !["paid", "cancelled", "debt", "complimentary"].includes(o.status)
    ).length === 0;

    setPayingId(order.id);
    // v32: payOrder لم يَعُد يرمي — يحفظ محليًا دائمًا ويُعيد حالة المزامنة
    const payRes = await store.payOrder(paid, cashEntry, { freeTable: shouldFreeTable });

    // v23: خصم المخزون عند الدفع (للطلبات الجديدة غير المخصومة)
    deductOrderStock(store, order);

    // v24: تسجيل مصروف تلقائي لتكلفة شراء "الطلبات الخاصة" (شراء وبيع)
    const customLines = (order.items || []).filter(it => it.special === "custom" && (it.customCost || 0) > 0);
    if (customLines.length) {
      const exps = customLines.map(it => ({
        id: "exp_sp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        label: "شراء: " + it.itemName, description: "تكلفة طلب خاص — " + it.itemName,
        amount: (it.customCost || 0) * (it.qty || 1), category: "purchases",
        date: new Date().toISOString(), by: user.name, createdBy: user.name,
        orderId: order.id, orderNum: order.orderNum, isSecondary: false,
        shiftId: openShift?.id || order.shiftId || null, // v4.7.0
      }));
      store.setExpenses(p => [...exps, ...p]);
      logActivity({ action: "مصروف تلقائي", details: `تكلفة طلب خاص (${customLines.length})`, userName: user.name, userRole: user.role, orderNum: order.orderNum, amount: exps.reduce((a, e) => a + e.amount, 0), branch: order.branch || "main" });
    }

    if (order.customerName && order.customerName !== "زبون") {
      const cust = (store.customers || []).find(c => c.name === order.customerName);
      if (cust) {
        const newSpent = (cust.totalSpent || 0) + finalTotal; // v31.4: الإنفاق يُحتسب عند الدفع
        const tier = getCustomerTier(cust.totalSpent || 0, settings);
        const earned = settings?.loyaltyEnabled ? Math.floor(calcEarnedPoints(finalTotal, settings) * tier.mult) : 0;
        store.setCustomers(p => p.map(c => c.id === cust.id
          ? { ...c, totalSpent: newSpent, loyaltyPoints: (c.loyaltyPoints || 0) + earned }
          : c));
        if (earned > 0) {
          store.setLoyaltyLog(p => [{
            id: "loy_" + Date.now(), customerId: cust.id, customerName: cust.name,
            type: "earn", points: earned, orderId: order.id, orderNum: order.orderNum,
            note: `كسب من طلب #${order.orderNum}`, createdBy: user.name,
            createdAt: new Date().toISOString(),
          }, ...p]);
        }
      }
    }

    // ✅ الفاتورة تُحفظ هنا فقط — عند الدفع
    saveReceiptRecord(paid, settings, store, tronAmt);

    // v22: سجل النشاط
    logActivity({
      action: "دفع طلب", details: `${payType === "card" ? "بطاقة" : payType === "tron" ? "ترون" : "نقدي"}${disc ? ` — خصم ${disc.toLocaleString()} ${CUR}` : ""}`,
      userName: user.name, userRole: user.role, orderNum: order.orderNum,
      amount: finalTotal, branch: order.branch || "main",
    });

    try { await generateReceiptPDF(paid, settings, tronAmt); } catch (e) { console.warn("receipt pdf:", e); }

    if (payRes && payRes.cloud === false) showToast(`💾 تم الدفع محليًا (#${order.orderNum}) — سيُزامن تلقائيًا عند عودة الاتصال`, "warn");
    else showToast(`💰 تم الدفع — ${order.customerName || "زبون"} #${order.orderNum}`);
    autoFreeTable(order.table, updated);
    setDiscounts(p => { const n = { ...p }; delete n[order.id]; return n; });
    setDiscInput(p => { const n = { ...p }; delete n[order.id]; return n; });
    setTronAmounts(p => { const n = { ...p }; delete n[order.id]; return n; });
    setTronModal(null);
    setPayingId(null);
  };

  const markDebt = (order) => {
    setDebtNameInput(order.customerName && order.customerName !== "زبون" ? order.customerName : "");
    setDebtNameError("");
    setDebtMergeMode(false);
    setDebtMergeName("");
    setDebtModal(order);
  };

  const confirmDebt = () => {
    const nameToUse = debtMergeMode ? debtMergeName.trim() : debtNameInput.trim();
    if (!nameToUse) {
      setDebtNameError("⚠️ يجب إدخال اسم الزبون لتسجيل الدين");
      return;
    }
    const order = debtModal;
    { const _cur = store.orders.find(o => o.id === order.id); if (_cur && !["ready","preparing","pending"].includes(_cur.status)) { showToast("⚠ الطلب عولج مسبقًا (رُبّما من جهاز آخر)", "warn"); setDebtModal(null); return; } } // v33: حارس إغلاق مزدوج
    const openShift = (store.shifts || []).find(s => s.status === "open" && s.branch === (order.branch || "main")); // v4.7.0
    const updated = store.orders.map(o =>
      o.id === order.id ? { ...o, status: "debt", paymentStatus: "debt", paymentType: "debt", customerName: nameToUse, stockDeducted: true, shiftId: openShift?.id || o.shiftId || null } : o
    );
    store.setOrders(() => updated);
    deductOrderStock(store, order); // v23: خصم عند تحويل الطلب لدين
    logActivity({ action: "تسجيل دين", details: nameToUse, userName: user.name, userRole: user.role, orderNum: order.orderNum, amount: order.total, branch: order.branch || "main" });

    if (debtMergeMode) {
      const existingDebt = store.debts.find(
        d => !d.settled && d.customerName.trim() === nameToUse
      );
      if (existingDebt) {
        store.setDebts(p => p.map(d =>
          d.id === existingDebt.id
            ? { ...d, amount: d.amount + order.total, remaining: d.remaining + order.total,
                notes: (d.notes ? d.notes + " | " : "") + `طلب #${order.orderNum}: ${order.total.toLocaleString()} ${CUR}` }
            : d
        ));
        showToast(`💳 تمت إضافة ${order.total.toLocaleString()} ${CUR} لدين ${nameToUse}`, "warn");
      } else {
        store.setDebts(p => [{
          id: "d" + Date.now(), orderId: order.id, orderNum: order.orderNum,
          customerName: nameToUse, amount: order.total, remaining: order.total,
          date: new Date().toISOString(), settled: false, settledAt: null,
          createdBy: user.name, notes: order.notes || "",
        }, ...p]);
        showToast(`💳 تم إنشاء دين جديد لـ ${nameToUse} (لم يوجد دين سابق)`, "warn");
      }
    } else {
      store.setDebts(p => [{
        id: "d" + Date.now(), orderId: order.id, orderNum: order.orderNum,
        customerName: nameToUse, amount: order.total, remaining: order.total,
        date: new Date().toISOString(), settled: false, settledAt: null,
        createdBy: user.name, notes: order.notes || "",
      }, ...p]);
      showToast(`💳 تم تسجيل الدين — ${nameToUse}`, "warn");
    }

    autoFreeTable(order.table, updated);
    setDebtModal(null);
    setDebtNameInput("");
    setDebtMergeMode(false);
    setDebtMergeName("");
  };

  const openComp = (order) => {
    setCompItems(order.items.map((_, i) => ({ idx: i, qty: 0, selected: false })));
    setCompModal(order);
  };

  // v31.4: إغلاق الطلب كمشروب عامل — يمرّ بالبار والكاشير كطلب عادي، ثم يُغلق بلا دفع
  // ويُسجَّل في الضيافة تحت بند «مشروب عامل» بسعر التكلفة (صفر إيراد/ربح)، ويخصم المخزون مرة واحدة.
  const openWorker = (order) => {
    const staffNames = (store.users || []).filter(u => u.role !== "customer" && u.active !== false).map(u => u.name);
    const def = staffNames.includes(order.customerName) ? order.customerName : (staffNames[0] || "");
    setWorkerName(def);
    setWorkerModal(order);
  };
  const confirmWorker = () => {
    const order = workerModal;
    { const _cur = store.orders.find(o => o.id === order.id); if (_cur && !["ready","preparing","pending"].includes(_cur.status)) { showToast("⚠ الطلب عولج مسبقًا (رُبّما من جهاز آخر)", "warn"); setWorkerModal(null); return; } } // v33: حارس إغلاق مزدوج
    if (!order) return;
    if (!workerName) { showToast("اختر العامل", "warn"); return; }
    const costTotal = (order.items || []).reduce((s, it) => {
      const m = (store.menu || []).find(x => x.id === it.itemId);
      return s + ((m?.cost || 0) * (it.qty || 0));
    }, 0);
    const openShift = (store.shifts || []).find(s => s.status === "open" && s.branch === (order.branch || "main")); // v4.7.0
    const updated = store.orders.map(o => o.id === order.id ? {
      ...o, status: "complimentary", paymentType: "worker", isComplimentary: true,
      paidBy: user.id, paidByName: user.name, paidAt: new Date().toISOString(),
      total: 0, originalTotal: o.originalTotal || order.total, stockDeducted: true,
      workerName,                       // v4.7.0: حفظ اسم العامل على الطلب
      compAmount: (o.compAmount || 0) + costTotal, // v4.7.0: تظهر تكلفته في تقارير الضيافة
      shiftId: openShift?.id || o.shiftId || null, // v4.7.0
    } : o);
    store.setOrders(() => updated);
    deductOrderStock(store, order); // خصم مرة واحدة
    store.setCompLog(p => [{
      id: "wrk" + Date.now(), reason: "worker",
      customerName: workerName, tableNum: order.table || "",
      items: (order.items || []).map(it => `${it.itemName}${it.qty > 1 ? ` ×${it.qty}` : ""}`),
      amount: costTotal, date: new Date().toISOString(),
      createdBy: user.name, orderId: order.id, orderNum: order.orderNum,
    }, ...p]);
    autoFreeTable(order.table, updated);
    logActivity({ action: "مشروب عامل", details: `${workerName} — طلب #${order.orderNum}`, userName: user.name, userRole: user.role, orderNum: order.orderNum, amount: costTotal, branch: order.branch || "main" });
    showToast(`☕ سُجّل مشروب العامل — ${costTotal.toLocaleString()} ${CUR} تكلفة`, "success");
    setWorkerModal(null);
  };


  const confirmComp = (fullComp) => {
    const order = compModal;
    { const _cur = store.orders.find(o => o.id === order.id); if (_cur && !["ready","preparing","pending"].includes(_cur.status)) { showToast("⚠ الطلب عولج مسبقًا (رُبّما من جهاز آخر)", "warn"); setCompModal(null); return; } } // v33: حارس إغلاق مزدوج
    const openShift = (store.shifts || []).find(s => s.status === "open" && s.branch === (order.branch || "main")); // v4.7.0
    let compAmt = 0;
    let updatedItems = [...order.items];
    if (fullComp) {
      compAmt = order.total;
      updatedItems = order.items.map(it => ({ ...it, complimentary: true }));
    } else {
      updatedItems = order.items.map((it, i) => {
        const ci = compItems[i];
        if (!ci?.selected || !ci.qty) return it;
        if (it.complimentary || it.compQty >= it.qty) return it;
        compAmt += it.price * Math.min(ci.qty, it.qty - (it.compQty || 0));
        return { ...it, compQty: Math.min((it.compQty || 0) + ci.qty, it.qty), complimentary: (it.compQty || 0) + ci.qty >= it.qty };
      });
    }
    if (compAmt <= 0) { showToast("⚠ لا توجد أصناف جديدة للضيافة", "warn"); setCompModal(null); return; }
    const remaining = order.total - compAmt;
    const fullyComp = remaining <= 0;
    const updated = store.orders.map(o => o.id === order.id ? {
      ...o, status: fullyComp ? "complimentary" : "ready",
      items: updatedItems, compAmount: (o.compAmount||0) + compAmt,
      total: Math.max(0, remaining), originalTotal: o.originalTotal || order.total,
      isComplimentary: fullyComp,
      paidBy: user.id, paidByName: user.name, paidAt: new Date().toISOString(),
      stockDeducted: fullyComp ? true : (o.stockDeducted !== false), // v23
      shiftId: openShift?.id || o.shiftId || null, // v4.7.0
    } : o);
    store.setOrders(() => updated);
    if (fullyComp) deductOrderStock(store, order); // v23: الضيافة الكاملة = تسليم
    store.setCompLog(p => [{
      id: "comp" + Date.now(),
      customerName: order.customerName || "زبون",
      tableNum: order.table || "",
      items: updatedItems.filter(it => it.complimentary || it.compQty > 0).map(it => it.itemName),
      amount: compAmt, date: new Date().toISOString(),
      createdBy: user.name, orderId: order.id, orderNum: order.orderNum,
    }, ...p]);
    if (remaining <= 0) autoFreeTable(order.table, updated);
    logActivity({ action: "ضيافة", details: fullyComp ? "ضيافة كاملة" : "ضيافة جزئية", userName: user.name, userRole: user.role, orderNum: order.orderNum, amount: compAmt, branch: order.branch || "main" });
    notifyTelegram(settings?.telegramTargets||[], "comp", buildEventMsg("comp", { orderNum: order.orderNum, customerName: order.customerName, amount: compAmt, details: fullyComp ? "ضيافة كاملة" : "ضيافة جزئية", by: user.name }, settings?.cafeName||"ناردين كافيه", settings?.currency||"ل.س"));
    showToast(`🎁 تم تسجيل الضيافة — ${compAmt.toLocaleString()} ${CUR}`, "warn");
    setCompModal(null);
  };

  const openTron = (order) => {
    setTronInput(String(tronAmounts[order.id] || ""));
    setTronModal(order);
  };

  return (
    <div className="fade-in">
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 20 }}>
        {[
          ["💰", "إيرادات اليوم", todayRevenue, "#2e7d32"],
          ["📈", "صافي ربح اليوم", todayProfit, "#00897b"],
          ["📋", "طلبات جاهزة", readyOrders.length, "#1565c0"],
          ["🧾", "الجرد اليومي", dailyInventory, dailyInventory>=0?"#6a1b9a":"#e65100"],
          ["💠", "الترون اليوم", tronToday, "#6a1b9a"],
        ].map(([em, lbl, val, col]) => (
          <div key={lbl} className="card" style={{ borderTop: `4px solid ${col}`, textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{em}</div>
            <div style={{ fontSize: 11, color: "var(--sub)" }}>{lbl}</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: col }}>
              {typeof val === "number" && val > 999 ? val.toLocaleString() + " " + CUR : val}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
        <input className="input" placeholder="🔍 فلترة بالزبون..." value={customerFilter}
          onChange={e => setCustomerFilter(e.target.value)}
          style={{ maxWidth: 240, fontSize: 13 }} />
        {customerFilter && (
          <button onClick={() => setCustomerFilter("")}
            style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "var(--card2)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            ✕ إلغاء
          </button>
        )}
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12, color: "#c62828" }}>
        ⏳ طلبات جاهزة للدفع ({filteredReady.length})
        <button onClick={() => { generateZReportPDF(store, settings, user); logActivity({ action: "تقرير إقفال", details: "تقرير اليوم", userName: user.name, userRole: user.role }); }}
          style={{ float: "left", background: "#1a237e", color: "#fff", border: "none", borderRadius: 9, padding: "7px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          🧾 تقرير إقفال اليوم
        </button>
      </h3>

      {!filteredReady.length ? (
        <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--sub)" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div>لا توجد طلبات جاهزة في الوقت الحالي</div>
        </div>
      ) : filteredReady.map(order => {
        const disc = discounts[order.id] || 0;
        const discAmt = Math.min(Math.max(0, disc), order.total); // v31.5: مبلغ ثابت
        const finalTotal = order.total - discAmt;
        const tronAmt = tronAmounts[order.id] || 0;

        return (
          <div key={order.id} className="card" style={{ marginBottom: 14, borderRight: "4px solid #2e7d32" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>طلب #{order.orderNum}</div>
                <div style={{ fontSize: 12, color: "var(--sub)" }}>
                  {order.customerName} {order.table ? `• طاولة ${order.table}` : ""}
                </div>
              </div>
              <span style={{ background: "rgba(46,125,50,.2)", color: "#2e7d32", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 700 }}>جاهز</span>
            </div>

            {(order.items || []).map((i, idx) => (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px dashed var(--border)" }}>
                <span style={{display:"inline-flex",alignItems:"center",gap:6}}><ItemVisual item={store.menu.find(m=>m.id===i.itemId)||i} size={22} round={6}/>{i.itemName} ×{i.qty}{i.note?<span style={{color:"#c62828",fontWeight:700,marginInlineStart:4}}>📝{i.note}</span>:""}</span>
                <span style={{ fontWeight: 700 }}>{(i.price * i.qty).toLocaleString()} {CUR}</span>
              </div>
            ))}

            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: "var(--sub)", whiteSpace: "nowrap" }}>خصم ({CUR})</label>
              <input type="number" min="0" max={order.total} value={discInput[order.id] ?? ""}
                placeholder="0"
                onChange={e => setDiscInput(p => ({ ...p, [order.id]: Math.min(order.total, Math.max(0, +e.target.value)) }))}
                style={{ width: 90, padding: "5px 8px", borderRadius: 8, border: "1.5px solid var(--border)", fontSize: 13, background: "var(--card)", color: "var(--text)" }} />
              <button onClick={() => {
                const amt = Math.min(order.total, Math.max(0, +(discInput[order.id] || 0)));
                if (amt <= 0) { showToast("أدخل مبلغ خصم صحيحاً", "warn"); return; }
                setDiscConfirm({ orderId: order.id, amount: amt });
              }}
                style={{ background: "rgba(230,81,0,.12)", color: "#e65100", border: "1.5px solid rgba(230,81,0,.3)", borderRadius: 8, padding: "5px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                ✓ تثبيت الخصم
              </button>
              {disc > 0 && (
                <button onClick={() => { setDiscounts(p => { const n = { ...p }; delete n[order.id]; return n; }); setDiscInput(p => { const n = { ...p }; delete n[order.id]; return n; }); }}
                  style={{ background: "transparent", color: "#c62828", border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                  ✕ إلغاء الخصم
                </button>
              )}
              <button onClick={() => openTron(order)}
                style={{ background: tronAmt > 0 ? "rgba(106,27,154,.2)" : "rgba(106,27,154,.1)", color: "#6a1b9a", border: "1.5px solid rgba(106,27,154,.3)", borderRadius: 8, padding: "5px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                💠 {tronAmt > 0 ? `ترون: ${tronAmt.toLocaleString()} ${CUR}` : "إضافة ترون"}
              </button>
            </div>

            <div style={{ marginTop: 10, padding: "8px 0", borderTop: "2px solid var(--border)" }}>
              {disc > 0 && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--sub)", marginBottom: 2 }}>
                    <span>قبل الخصم</span><span>{order.total.toLocaleString()} {CUR}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#2e7d32", marginBottom: 4 }}>
                    <span>خصم</span><span>-{discAmt.toLocaleString()} {CUR}</span>
                  </div>
                </>
              )}
              {tronAmt > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#6a1b9a", marginBottom: 4 }}>
                  <span>💠 الترون</span><span>{tronAmt.toLocaleString()} {CUR}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 900 }}>
                <span>الإجمالي</span>
                <span style={{ color: "#c62828" }}>{finalTotal.toLocaleString()} {CUR}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={() => setCashConfirm(order)} disabled={!!payingId}
                style={{ flex: 2, minWidth: 100, background: "#2e7d32", color: "#fff", border: "none", borderRadius: 10, padding: "10px 8px", fontWeight: 700, fontSize: 13, cursor: payingId ? "wait" : "pointer", opacity: payingId && payingId !== order.id ? .5 : 1 }}>
                {payingId === order.id ? "⏳ جارٍ الدفع..." : "💵 دفع نقدي"}
              </button>
              {tronAmt > 0 && (
                <button onClick={() => markPaid(order, "tron")} disabled={!!payingId}
                  style={{ flex: 1, minWidth: 70, background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 10, padding: "10px 8px", fontWeight: 700, fontSize: 12, cursor: payingId ? "wait" : "pointer", opacity: payingId ? .6 : 1 }}>
                  💠 ترون
                </button>
              )}
              <button onClick={() => { setPartialInput(""); setPartialModal(order); }}
                style={{ flex: 1, minWidth: 70, background: "rgba(230,81,0,.15)", color: "#e65100", border: "1.5px solid rgba(230,81,0,.3)", borderRadius: 10, padding: "10px 8px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                💰 جزئي
              </button>
              <button onClick={() => openComp(order)}
                style={{ flex: 1, minWidth: 60, background: "rgba(0,137,123,.15)", color: "#00897b", border: "1.5px solid rgba(0,137,123,.25)", borderRadius: 10, padding: "10px 8px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                🎁 ضيافة
              </button>
              <button onClick={() => openWorker(order)}
                style={{ flex: 1, minWidth: 60, background: "rgba(121,85,72,.15)", color: "#795548", border: "1.5px solid rgba(121,85,72,.3)", borderRadius: 10, padding: "10px 8px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                ☕ مشروب عامل
              </button>
              <button onClick={() => markDebt(order)}
                style={{ flex: 1, minWidth: 60, background: "rgba(106,27,154,.15)", color: "#6a1b9a", border: "1.5px solid rgba(106,27,154,.25)", borderRadius: 10, padding: "10px 8px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                💳 دين
              </button>
            </div>
          </div>
        );
      })}

      {/* Partial Payment Modal */}
      {partialModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div className="card fade-in" style={{ width: "100%", maxWidth: 360 }}>
            <div style={{ textAlign: "center", fontSize: 44, marginBottom: 10 }}>💰</div>
            <h3 style={{ textAlign: "center", fontWeight: 900, marginBottom: 4 }}>دفع جزئي</h3>
            <p style={{ textAlign: "center", fontSize: 13, color: "var(--sub)", marginBottom: 14 }}>
              إجمالي الطلب: <strong>{partialModal.total.toLocaleString()} {CUR}</strong>
            </p>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", marginBottom: 6, display: "block" }}>المبلغ المدفوع الآن ({CUR})</label>
            <input className="input" type="number" min="0" max={partialModal.total} value={partialInput}
              autoFocus onChange={e => setPartialInput(e.target.value)}
              style={{ fontSize: 20, fontWeight: 900, textAlign: "center", marginBottom: 8 }} />
            {partialInput && +partialInput < partialModal.total && (
              <div style={{ background: "rgba(230,81,0,.1)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13, color: "#e65100", fontWeight: 700 }}>
                المتبقي: {(partialModal.total - +partialInput).toLocaleString()} {CUR} — سيُحوَّل لدين
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => {
                const paid = Math.min(Math.max(0, +partialInput || 0), partialModal.total);
                if (paid <= 0) { showToast("أدخل مبلغاً صحيحاً", "error"); return; }
                { const _c = store.orders.find(o => o.id === partialModal.id); if (_c && !["ready","preparing","pending"].includes(_c.status)) { showToast("⚠ الطلب عولج مسبقًا", "warn"); setPartialModal(null); return; } } // v33
                const offlineP = typeof navigator !== "undefined" && navigator.onLine === false; // v32: لا يحجب — يُحفظ محليًا
                if (paid >= partialModal.total) { markPaid(partialModal, "cash"); setPartialModal(null); return; }
                const remaining = partialModal.total - paid;
                const openShiftP = (store.shifts || []).find(s => s.status === "open" && s.branch === (partialModal.branch || "main")); // v4.7.0
                const updated = store.orders.map(o => o.id === partialModal.id ? {
                  ...o, status: "paid", paymentStatus: "partial",
                  paymentType: "cash", paidAt: new Date().toISOString(),
                  paidBy: user.id, paidByName: user.name,
                  partialPaid: paid, total: paid,
                  stockDeducted: true, // v23
                  shiftId: openShiftP?.id || o.shiftId || null, // v4.7.0
                } : o);
                store.setOrders(() => updated);
                deductOrderStock(store, partialModal); // v23: خصم عند الدفع الجزئي
                store.setCashLog(p => [{ id: "cash_part_" + partialModal.id + "_" + paid, orderId: partialModal.id, orderNum: partialModal.orderNum, amount: paid, at: new Date().toISOString(), by: user.name, type: "partial", branch: partialModal.branch || "main", shiftId: openShiftP?.id || null }, ...p]);
                store.setDebts(p => [{ id: "d" + Date.now(), orderId: partialModal.id, orderNum: partialModal.orderNum, customerName: partialModal.customerName || "زبون", amount: remaining, remaining, date: new Date().toISOString(), settled: false, settledAt: null, createdBy: user.name, notes: `دفع جزئي — دفع ${paid.toLocaleString()} ${CUR}` }, ...p]);
                saveReceiptRecord({ ...partialModal, total: paid, paymentType: "cash" }, settings, store, 0);
                autoFreeTable(partialModal.table, updated);
                logActivity({ action: "دفع جزئي", details: `دفع ${paid.toLocaleString()} — باقي ${remaining.toLocaleString()} دين`, userName: user.name, userRole: user.role, orderNum: partialModal.orderNum, amount: paid, branch: partialModal.branch || "main" });
                showToast(`✓ دفع جزئي ${paid.toLocaleString()} ${CUR} — باقي ${remaining.toLocaleString()} ${CUR} دين${offlineP ? " — سيُزامن لاحقًا" : ""}`);
                setPartialModal(null);
              }} style={{ flex: 2, padding: 12, borderRadius: 12, border: "none", background: "#e65100", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                ✓ تأكيد الدفع الجزئي
              </button>
              <button onClick={() => setPartialModal(null)}
                style={{ flex: 1, padding: 12, borderRadius: 12, border: "1.5px solid var(--border)", background: "none", color: "var(--text)", fontWeight: 700, cursor: "pointer" }}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tron Modal */}
      {tronModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div className="card fade-in" style={{ width: "100%", maxWidth: 360 }}>
            <div style={{ textAlign: "center", fontSize: 44, marginBottom: 10 }}>💠</div>
            <h3 style={{ textAlign: "center", fontWeight: 900, marginBottom: 4 }}>دفع بالترون</h3>
            <p style={{ textAlign: "center", fontSize: 13, color: "var(--sub)", marginBottom: 14 }}>
              طلب #{tronModal.orderNum} — إجمالي: {tronModal.total.toLocaleString()} {CUR}
            </p>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", marginBottom: 6, display: "block" }}>
              مبلغ الترون ({CUR})
            </label>
            <input className="input" type="number" min="0" placeholder="0" value={tronInput}
              autoFocus onChange={e => setTronInput(e.target.value)}
              style={{ fontSize: 20, fontWeight: 900, textAlign: "center", marginBottom: 14 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => {
                const amt = Math.max(0, +tronInput || 0);
                setTronAmounts(p => ({ ...p, [tronModal.id]: amt }));
                setTronModal(null);
                showToast(`💠 تم تسجيل الترون: ${amt.toLocaleString()} ${CUR}`);
              }} style={{ flex: 2, padding: 12, borderRadius: 12, border: "none", background: "#6a1b9a", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                ✓ تأكيد
              </button>
              <button onClick={() => setTronModal(null)}
                style={{ flex: 1, padding: 12, borderRadius: 12, border: "1.5px solid var(--border)", background: "none", color: "var(--text)", fontWeight: 700, cursor: "pointer" }}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debt Modal */}
      {debtModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div className="card fade-in" style={{ width: "100%", maxWidth: 400 }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 44, marginBottom: 6 }}>💳</div>
              <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>تسجيل دين</h2>
              <p style={{ fontSize: 13, color: "var(--sub)" }}>طلب #{debtModal.orderNum} — {debtModal.total.toLocaleString()} {CUR}</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <button onClick={() => { setDebtMergeMode(false); setDebtNameError(""); }}
                style={{ padding: "10px 8px", borderRadius: 10, border: `2px solid ${!debtMergeMode ? "#6a1b9a" : "var(--border)"}`,
                  background: !debtMergeMode ? "rgba(106,27,154,.15)" : "var(--card2)",
                  color: !debtMergeMode ? "#6a1b9a" : "var(--text)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                📋 دين جديد
              </button>
              <button onClick={() => { setDebtMergeMode(true); setDebtNameError(""); }}
                style={{ padding: "10px 8px", borderRadius: 10, border: `2px solid ${debtMergeMode ? "#e65100" : "var(--border)"}`,
                  background: debtMergeMode ? "rgba(230,81,0,.15)" : "var(--card2)",
                  color: debtMergeMode ? "#e65100" : "var(--text)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                ➕ إضافة لدين سابق
              </button>
            </div>
            {!debtMergeMode ? (
              <>
                <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", marginBottom: 6, display: "block" }}>
                  اسم الزبون <span style={{ color: "#c62828" }}>*</span>
                </label>
                <input className="input" placeholder="اسم الزبون..." value={debtNameInput} autoFocus
                  onChange={e => { setDebtNameInput(e.target.value); setDebtNameError(""); }}
                  onKeyDown={e => e.key === "Enter" && confirmDebt()}
                  style={{ marginBottom: 10, fontSize: 16, fontWeight: 700 }} />
              </>
            ) : (
              <>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#e65100", marginBottom: 6, display: "block" }}>
                  اسم الزبون صاحب الدين السابق <span style={{ color: "#c62828" }}>*</span>
                </label>
                <input className="input" placeholder="اكتب الاسم بالضبط كما في سجل الديون..." value={debtMergeName} autoFocus
                  onChange={e => { setDebtMergeName(e.target.value); setDebtNameError(""); }}
                  onKeyDown={e => e.key === "Enter" && confirmDebt()}
                  style={{ marginBottom: 8, fontSize: 15, fontWeight: 700, borderColor: "#e65100" }} />
                {debtMergeName.length >= 1 && (() => {
                  const matches = (store.debts || []).filter(d =>
                    !d.settled && d.customerName.includes(debtMergeName)
                  ).slice(0, 4);
                  return matches.length > 0 ? (
                    <div style={{ background: "var(--card2)", borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
                      {matches.map(d => (
                        <button key={d.id} onClick={() => { setDebtMergeName(d.customerName); setDebtNameError(""); }}
                          style={{ display: "block", width: "100%", textAlign: "right", padding: "10px 14px",
                            background: "none", border: "none", borderBottom: "1px solid var(--border)",
                            cursor: "pointer", fontSize: 13, color: "var(--text)" }}>
                          <span style={{ fontWeight: 700 }}>{d.customerName}</span>
                          <span style={{ color: "#c62828", marginRight: 8, fontSize: 12 }}>
                            متبقي: {d.remaining.toLocaleString()} {CUR}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div style={{ background: "rgba(198,40,40,.08)", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#c62828" }}>
                      لا يوجد دين سابق بهذا الاسم — سيُنشأ دين جديد تلقائياً
                    </div>
                  );
                })()}
              </>
            )}
            {debtNameError && (
              <div style={{ background: "rgba(198,40,40,.15)", color: "#c62828", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
                {debtNameError}
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setDebtModal(null); setDebtMergeMode(false); setDebtMergeName(""); setDebtNameInput(""); }}
                style={{ flex: 1, padding: 12, borderRadius: 12, border: "1.5px solid var(--border)", background: "none", color: "var(--text)", fontWeight: 700, cursor: "pointer" }}>
                إلغاء
              </button>
              <button onClick={confirmDebt}
                style={{ flex: 2, padding: 12, borderRadius: 12, border: "none",
                  background: debtMergeMode ? "#e65100" : "#6a1b9a",
                  color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                {debtMergeMode ? "➕ إضافة للدين السابق" : "✓ تسجيل الدين"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complimentary Modal */}
      {cashConfirm && (() => {
        const d = discounts[cashConfirm.id] || 0;
        const dAmt = Math.min(Math.max(0, d), cashConfirm.total);
        const finalT = cashConfirm.total - dAmt;
        return (
          <div onClick={() => setCashConfirm(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 330, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>💵</div>
              <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>تأكيد الدفع النقدي</h3>
              <p style={{ fontSize: 13, color: "var(--sub)", marginBottom: 4 }}>طلب #{cashConfirm.orderNum} — {cashConfirm.customerName || "زبون"}</p>
              {dAmt > 0 && <p style={{ fontSize: 12, color: "#e65100", marginBottom: 4 }}>بعد خصم {dAmt.toLocaleString()} {CUR}</p>}
              <p style={{ fontSize: 24, fontWeight: 900, color: "#2e7d32", marginBottom: 16 }}>{finalT.toLocaleString()} {CUR}</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setCashConfirm(null)} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700 }}>لا</button>
                <button onClick={() => { const o = cashConfirm; setCashConfirm(null); markPaid(o, "cash"); }} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 800 }}>نعم، ادفع</button>
              </div>
            </div>
          </div>
        );
      })()}

      {discConfirm && (
        <div onClick={() => setDiscConfirm(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 330, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🏷️</div>
            <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>تثبيت الخصم</h3>
            <p style={{ fontSize: 14, color: "var(--sub)", marginBottom: 4 }}>هل أنت متأكد من تثبيت خصم</p>
            <p style={{ fontSize: 22, fontWeight: 900, color: "#e65100", marginBottom: 16 }}>{discConfirm.amount.toLocaleString()} {CUR}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setDiscConfirm(null)} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700 }}>لا</button>
              <button onClick={() => {
                setDiscounts(p => ({ ...p, [discConfirm.orderId]: discConfirm.amount }));
                try { const o = store.orders.find(x => x.id === discConfirm.orderId); logActivity({ action: "تثبيت خصم", details: `طلب #${o?.orderNum || ""} — ${discConfirm.amount.toLocaleString()} ${CUR}`, userName: user.name, userRole: user.role, orderNum: o?.orderNum || "", amount: discConfirm.amount, branch: "main" }); } catch {}
                showToast(`✓ ثُبّت خصم ${discConfirm.amount.toLocaleString()} ${CUR}`, "success");
                setDiscConfirm(null);
              }} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "#e65100", color: "#fff", fontWeight: 800 }}>نعم، ثبّت</button>
            </div>
          </div>
        </div>
      )}

      {workerModal && (
        <div onClick={() => setWorkerModal(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 360 }}>
            <div style={{ textAlign: "center", fontSize: 40, marginBottom: 8 }}>☕</div>
            <h3 style={{ textAlign: "center", fontWeight: 900, fontSize: 16, marginBottom: 4 }}>مشروب عامل</h3>
            <p style={{ textAlign: "center", fontSize: 12, color: "var(--sub)", marginBottom: 14 }}>
              طلب #{workerModal.orderNum} — يُغلق بلا دفع ويُسجَّل بالتكلفة (لا إيراد)
            </p>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 4 }}>العامل</label>
            <select value={workerName} onChange={e => setWorkerName(e.target.value)} className="input" style={{ marginBottom: 16 }}>
              {(store.users || []).filter(u => u.role !== "customer" && u.active !== false).map(u => (
                <option key={u.id} value={u.name}>{u.name} — {u.role}</option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setWorkerModal(null)} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700 }}>إلغاء</button>
              <button onClick={confirmWorker} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "#795548", color: "#fff", fontWeight: 800 }}>☕ تأكيد</button>
            </div>
          </div>
        </div>
      )}

      {compModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div className="card fade-in" style={{ width: "100%", maxWidth: 420 }}>
            <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 14 }}>🎁 تسجيل ضيافة</h3>
            {compModal.items.map((it, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                <input type="checkbox" checked={!!compItems[i]?.selected}
                  onChange={e => setCompItems(p => p.map((c, ci) => ci === i ? { ...c, selected: e.target.checked, qty: e.target.checked ? it.qty : 0 } : c))}
                  style={{ width: 18, height: 18, accentColor: "#00897b" }} />
                <span style={{ flex: 1, fontSize: 13, display:"inline-flex", alignItems:"center", gap:6 }}><ItemVisual item={store.menu.find(m=>m.id===it.itemId)||it} size={22} round={6}/>{it.itemName} ×{it.qty}{it.note?<span style={{color:"#c62828",fontWeight:700,marginInlineStart:4}}>📝{it.note}</span>:""}</span>
                {compItems[i]?.selected && (
                  <input type="number" min="1" max={it.qty} value={compItems[i]?.qty || it.qty}
                    onChange={e => setCompItems(p => p.map((c, ci) => ci === i ? { ...c, qty: Math.min(it.qty, Math.max(1, +e.target.value)) } : c))}
                    style={{ width: 55, padding: "4px 8px", borderRadius: 8, border: "1.5px solid var(--border)", fontSize: 13, background: "var(--card)", color: "var(--text)" }} />
                )}
                <span style={{ fontSize: 12, color: "#c62828", fontWeight: 700, minWidth: 80, textAlign: "left" }}>
                  {(it.price * (compItems[i]?.selected ? (compItems[i]?.qty || it.qty) : it.qty)).toLocaleString()} {CUR}
                </span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button onClick={() => confirmComp(true)} style={{ flex: 1, minWidth: 100, padding: 11, borderRadius: 10, border: "none", background: "#00897b", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>🎁 ضيافة كاملة</button>
              <button onClick={() => confirmComp(false)} style={{ flex: 1, minWidth: 100, padding: 11, borderRadius: 10, border: "none", background: "#f9a825", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>✓ ضيافة جزئية</button>
              <button onClick={() => setCompModal(null)} style={{ flex: 1, minWidth: 80, padding: 11, borderRadius: 10, border: "1.5px solid var(--border)", background: "none", color: "var(--text)", fontWeight: 700, cursor: "pointer" }}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function DebtsTab({store,user,showToast,dm,settings}){
  const CUR=settings?.currency||"ل.س";
  const [filter,setFilter]=useState("unsettled");
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({customerName:"",amount:"",notes:""});
  const [editDebtId,setEditDebtId]=useState(null); // v30: تعديل دين
  const [partialDebt,setPartialDebt]=useState(null); // v25.1: {id, remaining, amount} مودال استيفاء جزئي
  const [selectedPerson,setSelectedPerson]=useState(null); // v4.8.0: ملف الشخص
  const [search,setSearch]=useState(""); // v4.8.0: بحث بالاسم

  const debts=store.debts||[];

  const totalUnsettled=debts.filter(d=>!d.settled).reduce((s,d)=>s+d.remaining,0);
  const totalSettled=debts.filter(d=>d.settled).reduce((s,d)=>s+d.amount,0);

  // v4.8.0: تجميع الديون حسب الشخص — ملف لكل شخص يجمع ديونه
  const nameKey=(n)=>(n||"بدون اسم").trim();
  const groups=useMemo(()=>{
    const m=new Map();
    (debts||[]).forEach(d=>{
      const key=nameKey(d.customerName);
      if(!m.has(key)) m.set(key,{name:key,items:[],remaining:0,original:0,unsettledCount:0,settledCount:0,lastDate:0});
      const g=m.get(key);
      g.items.push(d);
      g.original+=d.amount||0;
      if(d.settled) g.settledCount++; else { g.remaining+=d.remaining||0; g.unsettledCount++; }
      const t=new Date(d.date).getTime(); if(t>g.lastDate) g.lastDate=t;
    });
    return Array.from(m.values());
  },[debts]);

  const visibleGroups=groups
    .filter(g=>filter==="all"?true:filter==="settled"?(g.unsettledCount===0&&g.settledCount>0):g.unsettledCount>0)
    .filter(g=>!search||g.name.includes(search.trim()))
    .sort((a,b)=>(b.remaining-a.remaining)||(b.lastDate-a.lastDate));

  const personGroup=selectedPerson?groups.find(g=>g.name===selectedPerson):null;
  const personItems=personGroup?[...personGroup.items].sort((a,b)=>new Date(b.date)-new Date(a.date)):[];

  const settleDebt=(id,amount)=>{
    const debt=store.debts.find(d=>d.id===id);
    store.setDebts(p=>p.map(d=>{
      if(d.id!==id) return d;
      const pay=Math.min(amount,d.remaining);
      const newRemaining=d.remaining-pay;
      return{...d,remaining:newRemaining,settled:newRemaining<=0,settledAt:newRemaining<=0?new Date().toISOString():null};
    }));
    store.setCashLog(p=>[{id:Date.now().toString(),orderId:"debt_"+id,orderNum:"دين",amount,at:new Date().toISOString(),by:user.name,type:"debt_payment"},...p]);
    const revEntry={
      id:"debt_rev_"+id+"_"+Date.now(),
      orderNum:"D-"+(debt?.customerName||id).slice(0,6),
      customerName:(debt?.customerName||"زبون")+" — دين",
      customerId:"debt",table:"-",
      items:[{itemId:"debt",itemName:"استيفاء دين",emoji:"💳",qty:1,price:amount}],
      total:amount,status:"paid",paymentType:"debt_settled",
      notes:"دين مستوفى — "+(debt?.notes||debt?.customerName||""),
      createdAt:new Date().toISOString(),paidAt:new Date().toISOString(),
      paidBy:user.name,discount:0,isDebtSettlement:true,
    };
    store.setOrders(p=>[revEntry,...p]);
    logActivity({ action: "سداد دين", details: debt?.customerName||"", userName: user.name, userRole: user.role, orderNum: "", amount, branch: "main" });
    notifyTelegram(settings?.telegramTargets||[], "debt", buildEventMsg("debt", { customerName: debt?.customerName||"زبون", amount, by: user.name }, settings?.cafeName||"ناردين كافيه", settings?.currency||"ل.س"));
    showToast(`✅ تم استيفاء الدين وإضافته للإيرادات`);
  };

  const addManualDebt=()=>{
    if(!form.customerName||!form.amount){showToast("يرجى ملء الحقول","error");return}
    if(editDebtId){
      const old=(store.debts||[]).find(d=>d.id===editDebtId);
      const untouched = old && !old.settled && old.remaining===old.amount; // المبلغ يُعدَّل فقط إن لم يُسدَّد شيء
      store.setDebts(p=>p.map(d=>d.id===editDebtId?{
        ...d, customerName:form.customerName, notes:form.notes,
        ...(untouched ? { amount:+form.amount, remaining:+form.amount } : {}),
      }:d));
      try{ logActivity({action:"تعديل دين",details:`${old?.customerName||""}→${form.customerName}${untouched?` • ${old?.amount}→${+form.amount}`:" • (المبلغ مقفل بعد السداد)"}`,userName:user.name,userRole:user.role,amount:+form.amount,branch:"main"}); }catch{}
      showToast(untouched?"✓ حُفظ التعديل":"✓ حُفظ (المبلغ مقفل بعد بدء السداد)");
      setShowAdd(false);setEditDebtId(null);setForm({customerName:"",amount:"",notes:""});
      return;
    }
    store.setDebts(p=>[{
      id:"d"+Date.now(),orderId:null,orderNum:"يدوي",
      customerName:form.customerName,amount:+form.amount,remaining:+form.amount,
      date:new Date().toISOString(),settled:false,settledAt:null,
      createdBy:user.name,notes:form.notes,
    },...p]);
    showToast("تم تسجيل الدين");setShowAdd(false);setForm({customerName:"",amount:"",notes:""});
  };

  const startEditDebt=(d)=>{
    setForm({customerName:d.customerName||"",amount:String(d.amount||""),notes:d.notes||""});
    setEditDebtId(d.id); setShowAdd(true);
  };

  // v4.8.0: تسجيل دين جديد لنفس الشخص من داخل ملفه
  const addForPerson=(name)=>{
    setForm({customerName:name==="بدون اسم"?"":name,amount:"",notes:""});
    setEditDebtId(null); setShowAdd(true);
  };

  // v4.8.0: بطاقة دين مفردة — تُستخدم داخل ملف الشخص (تفصيل الديون)
  const renderDebtCard=(d)=>(
    <div key={d.id} className="card" style={{borderRight:`4px solid ${d.settled?"#2e7d32":"#c62828"}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div>
          <div style={{fontSize:12,color:"var(--sub)"}}>
            {new Date(d.date).toLocaleDateString("ar-SY")} • طلب #{d.orderNum}
          </div>
        </div>
        <span style={{background:d.settled?"rgba(46,125,50,.2)":"rgba(198,40,40,.2)",
          color:d.settled?"#2e7d32":"#c62828",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:700}}>
          {d.settled?"✅ مستوفى":"⏳ معلق"}
        </span>
      </div>
      {!d.settled&&(
        <button onClick={()=>startEditDebt(d)} style={{padding:"4px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text)",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap",marginBottom:8}}>✏ تعديل</button>
      )}
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
          <button onClick={()=>setPartialDebt({id:d.id,remaining:d.remaining,amount:""})}
            style={{background:"rgba(46,125,50,.2)",color:"#2e7d32",border:"none",borderRadius:8,padding:"9px 12px",fontWeight:700,fontSize:12}}>
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
  );

  return(
    <div className="fade-in">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h2 style={{fontSize:18,fontWeight:900}}>💳 ملفّات الديون</h2>
        <button className="btn btn-red" onClick={()=> selectedPerson ? addForPerson(selectedPerson) : setShowAdd(true)}>+ دين يدوي</button>
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
      {selectedPerson && personGroup ? (
        /* ── ملف شخص واحد: يجمع ديونه ويعرض تفصيلها ── */
        <>
          <button onClick={()=>setSelectedPerson(null)}
            style={{background:"var(--card2)",border:"none",borderRadius:10,padding:"8px 16px",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:16,fontFamily:"inherit"}}>
            ← رجوع لكل الملفّات
          </button>
          <div className="card" style={{marginBottom:16,borderTop:`4px solid ${personGroup.unsettledCount?"#c62828":"#2e7d32"}`}}>
            <div style={{fontSize:36,textAlign:"center",marginBottom:6}}>👤</div>
            <div style={{fontWeight:900,fontSize:18,textAlign:"center",marginBottom:12}}>{personGroup.name}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div style={{textAlign:"center",background:"var(--card2)",borderRadius:10,padding:10}}>
                <div style={{fontSize:11,color:"var(--sub)"}}>إجمالي المتبقي</div>
                <div style={{fontWeight:900,fontSize:15,color:"#c62828"}}>{personGroup.remaining.toLocaleString()} {CUR}</div>
              </div>
              <div style={{textAlign:"center",background:"var(--card2)",borderRadius:10,padding:10}}>
                <div style={{fontSize:11,color:"var(--sub)"}}>ديون معلقة</div>
                <div style={{fontWeight:900,fontSize:18,color:"#f9a825"}}>{personGroup.unsettledCount}</div>
              </div>
              <div style={{textAlign:"center",background:"var(--card2)",borderRadius:10,padding:10}}>
                <div style={{fontSize:11,color:"var(--sub)"}}>إجمالي الأصلي</div>
                <div style={{fontWeight:700,fontSize:13,color:"var(--text)"}}>{personGroup.original.toLocaleString()} {CUR}</div>
              </div>
            </div>
            {personGroup.unsettledCount>1&&(
              <button onClick={()=>{ personItems.filter(d=>!d.settled).forEach(d=>settleDebt(d.id,d.remaining)); }}
                style={{width:"100%",marginTop:12,background:"#2e7d32",color:"#fff",border:"none",borderRadius:10,padding:"11px",fontWeight:900,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                ✅ استيفاء كل المتبقي ({personGroup.remaining.toLocaleString()} {CUR})
              </button>
            )}
          </div>
          <div style={{fontSize:13,fontWeight:800,color:"var(--sub)",marginBottom:10}}>📋 تفصيل الديون ({personItems.length})</div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {personItems.map(renderDebtCard)}
          </div>
        </>
      ) : (
        /* ── قائمة الملفّات: بطاقة لكل شخص ── */
        <>
          <input className="input" placeholder="🔍 بحث باسم الشخص" value={search}
            onChange={e=>setSearch(e.target.value)} style={{marginBottom:12}}/>
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {[["unsettled","معلقة"],["settled","مستوفاة"],["all","الكل"]].map(([v,l])=>(
              <button key={v} onClick={()=>setFilter(v)} style={{padding:"7px 16px",borderRadius:20,border:"none",
                background:filter===v?"#c62828":"var(--card2)",color:filter===v?"#fff":"var(--sub)",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                {l}
              </button>
            ))}
          </div>
          {!visibleGroups.length?(
            <div style={{textAlign:"center",padding:60,color:"var(--sub)"}}>
              <div style={{fontSize:48}}>💳</div><div style={{marginTop:10}}>لا توجد ملفّات ديون</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {visibleGroups.map(g=>(
                <button key={g.name} onClick={()=>setSelectedPerson(g.name)} className="card"
                  style={{textAlign:"right",border:"none",borderRight:`4px solid ${g.unsettledCount?"#c62828":"#2e7d32"}`,cursor:"pointer",width:"100%",fontFamily:"inherit",display:"block"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontWeight:900,fontSize:15}}>👤 {g.name}</div>
                      <div style={{fontSize:11,color:"var(--sub)",marginTop:3}}>
                        {g.unsettledCount?`${g.unsettledCount} دين معلق`:"كل الديون مستوفاة"}{g.settledCount?` • ${g.settledCount} مستوفى`:""} • آخر دين {new Date(g.lastDate).toLocaleDateString("ar-SY")}
                      </div>
                    </div>
                    <div style={{textAlign:"left",whiteSpace:"nowrap",paddingRight:10}}>
                      <div style={{fontWeight:900,fontSize:16,color:g.unsettledCount?"#c62828":"#2e7d32"}}>{g.remaining.toLocaleString()} {CUR}</div>
                      <div style={{fontSize:11,color:"var(--sub)"}}>المتبقي ›</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {partialDebt&&(
        <div onClick={e=>{if(e.target===e.currentTarget)setPartialDebt(null);}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}}>
          <div className="card fade-in" style={{width:"100%",maxWidth:340}}>
            <div style={{fontWeight:900,fontSize:16,marginBottom:6}}>💵 استيفاء جزئي</div>
            <div style={{fontSize:12,color:"var(--sub)",marginBottom:14}}>المتبقي: <b style={{color:"#c62828"}}>{partialDebt.remaining.toLocaleString()} {CUR}</b></div>
            <input className="input" type="number" min="0" inputMode="numeric" autoFocus
              placeholder="المبلغ المستوفى" value={partialDebt.amount}
              onChange={e=>setPartialDebt({...partialDebt,amount:e.target.value})}
              onKeyDown={e=>{if(e.key==="Enter"){const n=+partialDebt.amount;if(n>0&&n<=partialDebt.remaining){settleDebt(partialDebt.id,n);setPartialDebt(null);}else showToast("مبلغ غير صحيح","error");}}}
              style={{fontSize:16,fontWeight:700,marginBottom:14}}/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setPartialDebt(null)} style={{flex:1,background:"var(--card2)",color:"var(--text)",border:"1px solid var(--border)",borderRadius:10,padding:"11px",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>إلغاء</button>
              <button onClick={()=>{const n=+partialDebt.amount;if(n>0&&n<=partialDebt.remaining){settleDebt(partialDebt.id,n);setPartialDebt(null);}else showToast("مبلغ غير صحيح — يجب أن يكون بين 1 والمتبقي","error");}}
                style={{flex:2,background:"#2e7d32",color:"#fff",border:"none",borderRadius:10,padding:"11px",fontWeight:900,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>✓ استيفاء</button>
            </div>
          </div>
        </div>
      )}
      {showAdd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}}>
          <div className="card fade-in" style={{width:"100%",maxWidth:380}}>
            <div style={{fontWeight:900,fontSize:16,marginBottom:16}}>{editDebtId?"✏ تعديل دين":"➕ تسجيل دين يدوي"}</div>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>اسم الزبون</label>
              <input className="input" value={form.customerName} onChange={e=>setForm(f=>({...f,customerName:e.target.value}))}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>المبلغ ({CUR})</label>
              {(() => {
                const ed = editDebtId ? (store.debts||[]).find(d=>d.id===editDebtId) : null;
                const locked = ed && (ed.settled || ed.remaining!==ed.amount);
                return <>
                  <input className="input" type="number" value={form.amount} disabled={locked}
                    onChange={e=>setForm(f=>({...f,amount:e.target.value}))} style={locked?{opacity:.5}:undefined}/>
                  {locked&&<div style={{fontSize:11,color:"#e65100",marginTop:4}}>🔒 المبلغ مقفل لأن السداد بدأ — يمكن تعديل الاسم والملاحظات فقط</div>}
                </>;
              })()}
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:5,display:"block"}}>ملاحظات</label>
              <textarea className="input" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{height:60,resize:"none"}}/>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button className="btn btn-red" style={{flex:1}} onClick={addManualDebt}>{editDebtId?"حفظ التعديل":"تسجيل"}</button>
              <button className="btn btn-ghost" style={{flex:1}} onClick={()=>{setShowAdd(false);setEditDebtId(null);setForm({customerName:"",amount:"",notes:""});}}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ExpensesTab({store,user,showToast,dm,settings}){
  const CUR=settings?.currency||"ل.س";
  const today = businessDayStart();
  const [showAdd,setShowAdd]=useState(false);
  const [editId,setEditId]=useState(null); // v30: تعديل مصروف بدل الحذف
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
    if(period==="today"){return businessDayStart()}
    if(period==="week"){d.setDate(d.getDate()-7);return d}
    if(period==="month"){d.setDate(1);d.setHours(0,0,0,0);return d}
    return new Date(0);
  };

  const expenses=store.expenses||[];
  const filtered=expenses.filter(e=>new Date(e.date)>=getStart()).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const total=filtered.reduce((s,e)=>s+e.amount,0);

  const addExpense=()=>{
    if(!form.description||!form.amount){showToast("يرجى ملء الحقول","error");return}
    if(editId){
      const old=(store.expenses||[]).find(e=>e.id===editId);
      store.setExpenses(p=>p.map(e=>e.id===editId?{
        ...e, description:form.description, label:form.description, amount:+form.amount,
        category:form.category, notes:form.notes, isSecondary:form.isSecondary||false,
      }:e));
      try{ logActivity({action:"تعديل مصروف",details:`${old?.description||""}: ${old?.amount||0}→${+form.amount} • ${old?.isSecondary?"ثانوي":"يومي"}→${form.isSecondary?"ثانوي":"يومي"}`,userName:user.name,userRole:user.role,amount:+form.amount,branch:"main"}); }catch{}
      showToast("✓ حُفظ التعديل");
      setShowAdd(false);setEditId(null);setForm({description:"",amount:"",category:"other",notes:"",isSecondary:false});
      return;
    }
    store.setExpenses(p=>[{
      id:"exp"+Date.now(),description:form.description,label:form.description,amount:+form.amount,
      category:form.category,notes:form.notes,
      date:new Date().toISOString(),createdBy:user.name,by:user.name,
      isSecondary:form.isSecondary||false,
      shiftId:((store.shifts||[]).find(s=>s.status==="open"&&(s.branch||"main")==="main")||{}).id||null, // v4.7.0
    },...p]);
    showToast(form.isSecondary?"تم تسجيل المصروف الثانوي ⭐":"تم تسجيل المصروف");
    setShowAdd(false);setForm({description:"",amount:"",category:"other",notes:"",isSecondary:false});
  };

  const startEditExp=(e)=>{
    setForm({description:e.description||"",amount:String(e.amount||""),category:e.category||"other",notes:e.notes||"",isSecondary:!!e.isSecondary});
    setEditId(e.id); setShowAdd(true);
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
                  <div style={{fontWeight:700,fontSize:14}}>{e.description}
                    {e.isSecondary&&<span style={{fontSize:10,background:"rgba(249,168,37,.2)",color:"#f9a825",borderRadius:6,padding:"1px 6px",marginInlineStart:6,fontWeight:800}}>⭐ ثانوي</span>}
                  </div>
                  <div style={{fontSize:11,color:"var(--sub)"}}>
                    {cat.label.split(" ").slice(1).join(" ")} • {new Date(e.date).toLocaleDateString("ar-SY")} • {e.createdBy}
                  </div>
                  {e.notes&&<div style={{fontSize:11,color:"var(--sub)"}}>📝 {e.notes}</div>}
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                  <div style={{fontWeight:900,color:"#e65100",fontSize:15}}>{e.amount.toLocaleString()} {CUR}</div>
                  <button onClick={()=>startEditExp(e)} style={{padding:"4px 12px",borderRadius:8,border:"1px solid var(--border)",background:"var(--card2)",color:"var(--text)",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap"}}>✏ تعديل</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showAdd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}}>
          <div className="card fade-in" style={{width:"100%",maxWidth:380,maxHeight:"88vh",overflowY:"auto"}}>
            <div style={{fontWeight:900,fontSize:16,marginBottom:16}}>{editId?"✏ تعديل مصروف":"➕ مصروف جديد"}</div>
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
            <div style={{marginBottom:12}}>
              <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",
                padding:"10px 14px",borderRadius:12,
                background:form.isSecondary?"rgba(249,168,37,.15)":"var(--card2)",
                border:form.isSecondary?"1.5px solid #f9a825":"1.5px solid var(--border)"}}>
                <input type="checkbox" checked={form.isSecondary||false}
                  onChange={e=>setForm(f=>({...f,isSecondary:e.target.checked}))}
                  style={{width:18,height:18,accentColor:"#f9a825",flexShrink:0}}/>
                <span style={{fontWeight:700,fontSize:13,color:form.isSecondary?"#f9a825":"var(--text)"}}>
                  ⭐ مصروف ثانوي (لا يدخل في الجرد اليومي)
                </span>
              </label>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button className="btn btn-red" style={{flex:2,whiteSpace:"nowrap",background:form.isSecondary?"#f9a825":undefined}} onClick={addExpense}>{editId?"حفظ التعديل":"تسجيل"}</button>
              <button className="btn btn-ghost" style={{flex:1,whiteSpace:"nowrap"}} onClick={()=>{setShowAdd(false);setEditId(null);setForm({description:"",amount:"",category:"other",notes:"",isSecondary:false});}}>إلغاء</button>
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
