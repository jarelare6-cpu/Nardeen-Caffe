// src/OutdoorScreen.jsx — Nardeen Caffe v4.1
// ══════════════════════════════════════════════════════════════
// واجهة عامل الحديقة الخارجية — كاش منفصل + طاولات منفصلة
// ══════════════════════════════════════════════════════════════
import React, { useState, useCallback, useMemo } from "react";
import { sbDelete, sbUpsert, SUPABASE_READY, logActivity } from "./lib/supabase.js";
import { deductOrderStock, restoreOrderStock } from "./lib/stock.js";
import { CancelOrderModal } from "./uikit.jsx";

// ── الفئات المسموح بها في الحديقة (بدون أراكيل) ─────────────
const OUTDOOR_CATS = {
  hot_drinks:  "☕ مشروبات ساخنة",
  cold_drinks: "🧊 مشروبات باردة",
  food:        "🍔 طعام",
};
const CAT_ORDER = ["cold_drinks", "hot_drinks", "food"];

// ── Toast بسيط ────────────────────────────────────────────────
function OToast({ msg, type }) {
  if (!msg) return null;
  const bg = type === "error" ? "#c62828" : type === "warn" ? "#e65100" : "#2e7d32";
  return (
    <div style={{
      position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)",
      zIndex: 9999, background: bg, color: "#fff", padding: "10px 22px",
      borderRadius: 40, fontWeight: 700, fontSize: 14,
      boxShadow: "0 6px 24px rgba(0,0,0,.3)", animation: "fadeIn .3s ease",
      whiteSpace: "nowrap",
    }}>
      {type === "error" ? "✗" : "✓"} {msg}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// OUTDOOR SCREEN
// ══════════════════════════════════════════════════════════════
export default function OutdoorScreen({ user, store, onLogout, showToast: parentToast }) {
  const [tab, setTab]           = useState("tables");   // tables | order | cash | report
  const [toast, setToast]       = useState(null);
  const [selTable, setSelTable] = useState(null);
  const [cart, setCart]         = useState([]);
  const [search, setSearch]     = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [payType, setPayType]   = useState("cash");
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes]       = useState("");
  const [showPay, setShowPay]   = useState(null); // order to pay
  const [releaseModal, setReleaseModal] = useState(null); // v26: {table, order} تأكيد تحرير+إلغاء
  const [delTableModal, setDelTableModal] = useState(null); // v26: {table} تأكيد حذف طاولة
  const [compConfirm, setCompConfirm] = useState(null); // v26: تأكيد ضيافة كاملة
  const [isPaying, setIsPaying] = useState(false); // v23.1: قفل النقر المزدوج أثناء الدفع
  const [payTronInput, setPayTronInput] = useState("");
  const [payDebtName, setPayDebtName]   = useState("");
  const [payMode, setPayMode]   = useState("pay"); // pay | debt
  const [tableCount, setTableCount] = useState(null); // for settings

  const settings  = store.settings  || {};
  const CUR       = settings.currency || "ل.س";
  const outdoorTables = store.outdoorTables || [];
  const orders    = (store.orders || []).filter(o => o.branch === "outdoor");
  const receipts  = (store.receipts || []).filter(r => r.branch === "outdoor");

  // منيو الحديقة: يستخدم outdoor_price إذا موجود
  const menu = useMemo(() =>
    (store.menu || [])
      .filter(m => m.active !== false && OUTDOOR_CATS[m.category])
      .map(m => ({
        ...m,
        price: m.outdoorPrice ?? m.price,
      })),
    [store.menu]
  );

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── كاش الحديقة ────────────────────────────────────────────
  const outdoorCash = useMemo(() =>
    (store.cashLog || []).filter(e => e.branch === "outdoor"),
    [store.cashLog]
  );
  const outdoorTotal = outdoorCash.filter(e => e.type === "sale").reduce((s, e) => s + (e.amount || 0), 0);
  const partnerShare = Math.round(outdoorTotal / 3);
  const myShare      = outdoorTotal - partnerShare;

  // ── إضافة/إزالة من السلة ────────────────────────────────────
  const addToCart = (item) => {
    setCart(p => {
      const ex = p.find(c => c.itemId === item.id);
      if (ex) return p.map(c => c.itemId === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...p, { itemId: item.id, itemName: item.name, emoji: item.emoji, price: item.price, qty: 1 }];
    });
  };
  const removeFromCart = (itemId) => setCart(p => {
    const ex = p.find(c => c.itemId === itemId);
    if (ex?.qty > 1) return p.map(c => c.itemId === itemId ? { ...c, qty: c.qty - 1 } : c);
    return p.filter(c => c.itemId !== itemId);
  });

  const cartTotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const afterDiscount = Math.round(cartTotal * (1 - (discount || 0) / 100));

  // ── إرسال الطلب ─────────────────────────────────────────────
  const placeOrder = () => {
    if (!selTable) { showToast("اختر طاولة أولاً", "error"); return; }
    if (!cart.length) { showToast("السلة فارغة", "error"); return; }

    const orderNum = "O" + Date.now().toString().slice(-6);
    const newOrder = {
      id:           "ord_out_" + Date.now(),
      orderNum,
      customerName: "زبون حديقة",
      table:        selTable.label,
      items:        cart,
      total:        afterDiscount,
      originalTotal: cartTotal,
      discount:     discount || 0,
      status:       "pending",
      paymentType:  "cash",
      notes:        notes,
      createdAt:    new Date().toISOString(),
      workerName:   user.name,
      branch:       "outdoor",
      stockDeducted: false, // v23: الخصم عند الدفع لا عند الإنشاء
    };

    store.setOrders(p => [newOrder, ...p]);

    // تحديث الطاولة → مشغولة
    store.setOutdoorTables(p => p.map(t =>
      t.id === selTable.id
        ? { ...t, status: "busy", orderId: newOrder.id, openedAt: new Date().toISOString() }
        : t
    ));

    setCart([]);
    setNotes("");
    setDiscount(0);
    setSelTable(null);
    setTab("tables");
    showToast(`✓ طلب ${orderNum} مُسجّل`);
  };

  // ── تسديد الطلب (نقدي/بطاقة/ترون) — مطابق للكاش الرئيسي ──────
  const payOrder = async (order, pt, tronAmt = 0) => {
    if (isPaying) return; // v23.1: منع التسديد المزدوج (نافذة الانتظار)
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      showToast("⚠ لا يوجد اتصال بالإنترنت — لا يمكن إتمام الدفع", "error");
      return;
    }
    const now = new Date().toISOString();
    const openShift = (store.shifts || []).find(s => s.status === "open" && s.branch === "outdoor");

    const paidOrder = {
      ...order,
      status:       "paid",
      paymentStatus:"paid",
      paymentType:  pt,
      paidAt:       now,
      paidBy:       user.id,
      paidByName:   user.name,
      tronAmount:   tronAmt || 0,
      shiftId:      openShift?.id || null,
      branch:       "outdoor",
      stockDeducted: true, // v23
    };
    const cashEntry = {
      id: "cl_out_" + Date.now(), orderId: order.id, orderNum: order.orderNum,
      amount: order.total, at: now, by: user.name,
      type: pt === "tron" ? "tron" : "sale", branch: "outdoor",
      shiftId: openShift?.id || null,
    };
    setIsPaying(true);
    try {
      // v22/v23: السحابة أولاً (ذرّي) — تحرير الطاولة السحابية ضمن نفس العملية
      await store.payOrder(paidOrder, cashEntry, { freeTable: true });
    } catch (e) {
      showToast("⚠ فشل الدفع: " + (e?.message || "خطأ في الاتصال — حاول مجدداً"), "error");
      setIsPaying(false);
      return;
    }
    setIsPaying(false);
    deductOrderStock(store, order); // v23: خصم المخزون عند الدفع
    logActivity({ action: "دفع طلب", details: pt === "card" ? "بطاقة" : pt === "tron" ? "ترون" : "نقدي", userName: user.name, userRole: user.role, orderNum: order.orderNum, amount: order.total, branch: "outdoor" });

    // تحرير الطاولة محلياً
    store.setOutdoorTables(p => p.map(t =>
      t.orderId === order.id ? { ...t, status: "free", orderId: null, openedAt: null } : t
    ));

    // receipt
    store.setReceipts(p => [{
      id: "rcpt_out_" + order.id + "_" + Date.now(), orderId: order.id, orderNum: order.orderNum,
      customerName: order.customerName, tableNum: order.table, items: order.items,
      total: order.total, discount: order.discount || 0, paymentType: pt,
      notes: order.notes || "", createdBy: user.name, createdAt: now,
      cafeName: settings.cafeName || "Nardeen Caffe", tronAmount: tronAmt || 0, branch: "outdoor",
    }, ...p]);

    setShowPay(null);
    showToast(`✓ تم تسديد ${order.orderNum}`);
  };

  // ── تسجيل دين الحديقة ──────────────────────────────────────
  const debtOrder = (order, customerName) => {
    const now = new Date().toISOString();
    store.setOrders(p => p.map(o => o.id === order.id
      ? { ...o, status: "debt", paymentStatus: "debt", paymentType: "debt", customerName, stockDeducted: true } : o));
    deductOrderStock(store, order); // v23: خصم عند تحويل الطلب لدين
    logActivity({ action: "تسجيل دين", details: customerName, userName: user.name, userRole: user.role, orderNum: order.orderNum, amount: order.total, branch: "outdoor" });
    store.setOutdoorTables(p => p.map(t =>
      t.orderId === order.id ? { ...t, status: "free", orderId: null, openedAt: null } : t));
    store.setDebts(p => [{
      id: "d_out_" + Date.now(), orderId: order.id, orderNum: order.orderNum,
      customerName, amount: order.total, remaining: order.total,
      date: now, settled: false, settledAt: null, createdBy: user.name,
      notes: `حديقة — ${order.table}`, branch: "outdoor",
    }, ...p]);
    setShowPay(null);
    showToast(`💳 تم تسجيل دين ${customerName}`, "warn");
  };

  // ── ضيافة الحديقة (كامل الطلب) ─────────────────────────────
  const compOrder = (order) => {
    const now = new Date().toISOString();
    store.setOrders(p => p.map(o => o.id === order.id
      ? { ...o, status: "complimentary", isComplimentary: true,
          compAmount: order.total, originalTotal: order.total, total: 0,
          paidBy: user.id, paidByName: user.name, paidAt: now, stockDeducted: true } : o));
    deductOrderStock(store, order); // v23: الضيافة الكاملة = تسليم بضاعة
    logActivity({ action: "ضيافة", details: "ضيافة كاملة", userName: user.name, userRole: user.role, orderNum: order.orderNum, amount: order.total, branch: "outdoor" });
    store.setOutdoorTables(p => p.map(t =>
      t.orderId === order.id ? { ...t, status: "free", orderId: null, openedAt: null } : t));
    store.setCompLog(p => [{
      id: "comp_out_" + Date.now(), customerName: order.customerName || "زبون حديقة",
      tableNum: order.table, items: (order.items || []).map(it => it.itemName),
      amount: order.total, date: now, createdBy: user.name,
      orderId: order.id, orderNum: order.orderNum, branch: "outdoor",
    }, ...p]);
    setShowPay(null);
    showToast(`🎁 ضيافة ${order.orderNum}`, "warn");
  };

  // ── فلتر المنيو ──────────────────────────────────────────────
  const filteredMenu = useMemo(() => {
    let items = menu;
    if (catFilter !== "all") items = items.filter(m => m.category === catFilter);
    if (search) items = items.filter(m =>
      m.name.includes(search) || (m.nameEn || "").toLowerCase().includes(search.toLowerCase())
    );
    return items;
  }, [menu, catFilter, search]);

  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#0a1628", color: "#e8f4fd", fontFamily: "'Tajawal',sans-serif", direction: "rtl" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        .otab{padding:10px 14px;border:none;background:none;color:#8ab4d4;font-family:inherit;
          font-size:13px;font-weight:700;border-bottom:3px solid transparent;cursor:pointer;white-space:nowrap;transition:all .2s}
        .otab.active{color:#4fc3f7;border-bottom-color:#4fc3f7}
        .ocard{background:#0d2137;border-radius:14px;padding:14px;border:1px solid #1a3a5c}
        .obtn{border:none;border-radius:10px;padding:10px 18px;font-weight:700;font-size:13px;
          cursor:pointer;font-family:inherit;transition:all .2s}
        .obtn:hover{filter:brightness(1.15);transform:translateY(-1px)}
        .oinput{width:100%;padding:10px 14px;border:1.5px solid #1a3a5c;border-radius:10px;
          font-size:13px;background:#0d2137;color:#e8f4fd;font-family:inherit;outline:none}
        .oinput:focus{border-color:#4fc3f7}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .fade-in{animation:fadeIn .25s ease}
      `}</style>

      <OToast msg={toast?.msg} type={toast?.type} />

      {/* ── Header ── */}
      <header style={{
        background: "linear-gradient(135deg,#0d2137,#1a3a5c)",
        padding: "10px 16px", display: "flex", alignItems: "center",
        justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100,
        borderBottom: "1px solid #1a3a5c",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>🌿</span>
          <div>
            <div style={{ fontWeight: 900, fontSize: 15, color: "#4fc3f7" }}>الحديقة الخارجية</div>
            <div style={{ fontSize: 10, color: "#8ab4d4" }}>{settings.cafeName || "Nardeen Caffe"}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {SUPABASE_READY && (
            <span style={{ fontSize: 10, background: "rgba(76,175,80,.2)", borderRadius: 8,
              padding: "3px 8px", color: "#81c784", fontWeight: 700 }}>☁ متصل</span>
          )}
          <span style={{ fontSize: 12, color: "#8ab4d4" }}>{user.name}</span>
          <button className="obtn" onClick={onLogout}
            style={{ background: "rgba(255,255,255,.1)", color: "#fff", padding: "6px 12px", fontSize: 12 }}>
            خروج
          </button>
        </div>
      </header>

      {/* ── Nav ── */}
      <nav style={{ background: "#0d2137", borderBottom: "1px solid #1a3a5c",
        display: "flex", overflowX: "auto", padding: "0 8px" }}>
        {[
          ["tables", "🪑", "الطاولات"],
          ["order",  "➕", `طلب${cart.length ? ` (${cart.reduce((s,c)=>s+c.qty,0)})` : ""}`],
          ["cash",   "💰", "الكاشير"],
          ["report", "📊", "التقرير"],
        ].map(([t, icon, label]) => (
          <button key={t} className={`otab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {icon} {label}
          </button>
        ))}
      </nav>

      {/* ── Content ── */}
      <main style={{ padding: 14, maxWidth: 800, margin: "0 auto" }}>

        {/* ════════ TABLES TAB ════════ */}
        {tab === "tables" && (
          <div className="fade-in">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ fontSize: 17, fontWeight: 900, color: "#4fc3f7" }}>🪑 طاولات الحديقة</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="obtn" onClick={() => store.addOutdoorTable()}
                  style={{ background: "#1565c0", color: "#fff", padding: "7px 14px", fontSize: 12 }}>
                  + إضافة طاولة
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
              {outdoorTables.map(t => {
                const tableOrder = orders.find(o => o.id === t.orderId && o.status === "pending");
                const isBusy = t.status === "busy";
                return (
                  <div key={t.id} className="ocard" style={{
                    border: `2px solid ${isBusy ? "#e65100" : "#1a5c3a"}`,
                    background: isBusy ? "#1a1000" : "#0d2137",
                    cursor: "pointer", transition: "all .2s",
                  }}>
                    <div style={{ textAlign: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 28 }}>🪑</div>
                      <div style={{ fontWeight: 900, fontSize: 15, color: isBusy ? "#ff8f00" : "#4fc3f7" }}>
                        {t.label}
                      </div>
                      <div style={{ fontSize: 11, color: isBusy ? "#ff8f00" : "#4caf50", fontWeight: 700, marginTop: 2 }}>
                        {isBusy ? "● مشغولة" : "○ فارغة"}
                      </div>
                    </div>
                    {isBusy && tableOrder && (
                      <div style={{ fontSize: 11, color: "#8ab4d4", textAlign: "center", marginBottom: 8 }}>
                        {tableOrder.orderNum} — {tableOrder.total.toLocaleString()} {CUR}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
                      {!isBusy && (
                        <button className="obtn" onClick={() => { setSelTable(t); setTab("order"); }}
                          style={{ background: "#1b5e20", color: "#fff", width: "100%", fontSize: 12, padding: "7px 0" }}>
                          + طلب
                        </button>
                      )}
                      {isBusy && tableOrder && (
                        <button className="obtn" onClick={() => setShowPay(tableOrder)}
                          style={{ background: "#e65100", color: "#fff", width: "100%", fontSize: 12, padding: "7px 0" }}>
                          💰 تسديد
                        </button>
                      )}
                      {isBusy && (
                        <button className="obtn" onClick={() => setReleaseModal({ table: t, order: tableOrder })}
                          style={{ background: "#37474f", color: "#fff", width: "100%", fontSize: 11, padding: "6px 0" }}>
                          تحرير
                        </button>
                      )}
                      <button className="obtn" onClick={() => setDelTableModal({ table: t })}
                        style={{ background: "rgba(198,40,40,.15)", color: "#ef9a9a", width: "100%", fontSize: 11, padding: "5px 0", border: "1px solid rgba(198,40,40,.3)" }}>
                        حذف
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ════════ ORDER TAB ════════ */}
        {tab === "order" && (
          <div className="fade-in">
            <h2 style={{ fontSize: 17, fontWeight: 900, marginBottom: 14, color: "#4fc3f7" }}>➕ طلب جديد</h2>

            {/* اختيار الطاولة */}
            <div className="ocard" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#8ab4d4" }}>الطاولة</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {outdoorTables.filter(t => t.status === "free").map(t => (
                  <button key={t.id} className="obtn" onClick={() => setSelTable(t)}
                    style={{
                      background: selTable?.id === t.id ? "#4fc3f7" : "#1a3a5c",
                      color: selTable?.id === t.id ? "#000" : "#e8f4fd",
                      fontSize: 12, padding: "7px 14px",
                    }}>
                    {t.label}
                  </button>
                ))}
                {outdoorTables.filter(t => t.status === "free").length === 0 && (
                  <div style={{ color: "#8ab4d4", fontSize: 13 }}>كل الطاولات مشغولة</div>
                )}
              </div>
              {selTable && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#4fc3f7", fontWeight: 700 }}>
                  ✓ {selTable.label} محددة
                </div>
              )}
            </div>

            {/* بحث + فئات */}
            <div style={{ marginBottom: 12 }}>
              <input className="oinput" placeholder="🔍 بحث..." value={search}
                onChange={e => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>
                <button className="obtn" onClick={() => setCatFilter("all")}
                  style={{ background: catFilter === "all" ? "#4fc3f7" : "#1a3a5c",
                    color: catFilter === "all" ? "#000" : "#e8f4fd", fontSize: 12, padding: "6px 14px", whiteSpace: "nowrap" }}>
                  الكل
                </button>
                {CAT_ORDER.map(c => (
                  <button key={c} className="obtn" onClick={() => setCatFilter(c)}
                    style={{ background: catFilter === c ? "#4fc3f7" : "#1a3a5c",
                      color: catFilter === c ? "#000" : "#e8f4fd", fontSize: 12, padding: "6px 14px", whiteSpace: "nowrap" }}>
                    {OUTDOOR_CATS[c]}
                  </button>
                ))}
              </div>
            </div>

            {/* منيو */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 10, marginBottom: 16 }}>
              {filteredMenu.map(item => {
                const inCart = cart.find(c => c.itemId === item.id);
                return (
                  <div key={item.id} className="ocard" onClick={() => addToCart(item)}
                    style={{
                      cursor: "pointer", transition: "all .2s", position: "relative",
                      border: inCart ? "2px solid #4fc3f7" : "1px solid #1a3a5c",
                      transform: inCart ? "scale(1.03)" : "scale(1)",
                    }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ marginBottom: 4, minHeight: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {(item.image || "").trim()
                          ? <img src={item.image} alt={item.name} loading="lazy"
                              onError={e=>{e.currentTarget.style.display="none";const s=e.currentTarget.nextSibling;if(s)s.style.display="block";}}
                              style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 10 }}/>
                          : null}
                        {(item.image || "").trim()
                          ? <span style={{ display: "none", fontSize: 28 }}>{item.emoji}</span>
                          : <span style={{ fontSize: 28 }}>{item.emoji}</span>}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>{item.name}</div>
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#4fc3f7" }}>
                        {item.price.toLocaleString()} {CUR}
                      </div>
                      {item.outdoorPrice != null && (
                        <div style={{ fontSize: 10, color: "#ff8f00", marginTop: 2 }}>سعر خارجي</div>
                      )}
                    </div>
                    {inCart && (
                      <div style={{
                        position: "absolute", top: 6, left: 6, background: "#4fc3f7",
                        color: "#000", borderRadius: "50%", width: 20, height: 20,
                        fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center",
                      }}>{inCart.qty}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* السلة */}
            {cart.length > 0 && (
              <div className="ocard" style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10, color: "#4fc3f7" }}>🛒 السلة</div>
                {cart.map(item => (
                  <div key={item.itemId} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 18 }}>{item.emoji}</span>
                    <div style={{ flex: 1, fontSize: 13 }}>{item.itemName}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button onClick={() => removeFromCart(item.itemId)}
                        style={{ background: "rgba(198,40,40,.2)", border: "none", color: "#ef9a9a",
                          borderRadius: 6, width: 24, height: 24, fontSize: 16, cursor: "pointer", fontFamily: "inherit" }}>−</button>
                      <span style={{ fontWeight: 900, minWidth: 20, textAlign: "center" }}>{item.qty}</span>
                      <button onClick={() => addToCart(item)}
                        style={{ background: "rgba(76,175,80,.2)", border: "none", color: "#a5d6a7",
                          borderRadius: 6, width: 24, height: 24, fontSize: 16, cursor: "pointer", fontFamily: "inherit" }}>+</button>
                    </div>
                    <div style={{ minWidth: 70, textAlign: "left", fontWeight: 700, color: "#4fc3f7", fontSize: 13 }}>
                      {(item.price * item.qty).toLocaleString()} {CUR}
                    </div>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid #1a3a5c", marginTop: 10, paddingTop: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, color: "#8ab4d4" }}>خصم %</span>
                    <input className="oinput" type="number" min="0" max="100" value={discount}
                      onChange={e => setDiscount(+e.target.value)}
                      style={{ width: 70, textAlign: "center" }} />
                  </div>
                  <textarea className="oinput" placeholder="ملاحظات..." value={notes}
                    onChange={e => setNotes(e.target.value)}
                    style={{ resize: "none", height: 56, marginBottom: 10 }} />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 900, marginBottom: 12 }}>
                    <span>الإجمالي</span>
                    <span style={{ color: "#4fc3f7" }}>{afterDiscount.toLocaleString()} {CUR}</span>
                  </div>
                  <button className="obtn" onClick={placeOrder}
                    style={{ background: "#1b5e20", color: "#fff", width: "100%", padding: 13, fontSize: 15 }}>
                    ✓ تسجيل الطلب
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════ CASH TAB ════════ */}
        {tab === "cash" && (
          <div className="fade-in">
            <h2 style={{ fontSize: 17, fontWeight: 900, marginBottom: 14, color: "#4fc3f7" }}>💰 كاشير الحديقة</h2>

            {/* الطلبات المعلقة */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#ff8f00", marginBottom: 10 }}>
                ⏳ طلبات بانتظار التسديد ({orders.filter(o => o.status === "pending").length})
              </div>
              {orders.filter(o => o.status === "pending").length === 0 ? (
                <div className="ocard" style={{ textAlign: "center", color: "#8ab4d4", padding: 24 }}>
                  لا توجد طلبات معلقة
                </div>
              ) : orders.filter(o => o.status === "pending").map(order => (
                <div key={order.id} className="ocard" style={{ marginBottom: 10, borderRight: "4px solid #ff8f00" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontWeight: 900, color: "#4fc3f7" }}>#{order.orderNum}</span>
                    <span style={{ fontSize: 12, color: "#8ab4d4" }}>{order.table}</span>
                  </div>
                  {order.items?.map((it, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#8ab4d4", padding: "2px 0" }}>
                      {it.emoji} {it.itemName} ×{it.qty} — {(it.price * it.qty).toLocaleString()} {CUR}
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <span style={{ fontWeight: 900, color: "#4fc3f7", fontSize: 16 }}>
                      {order.total.toLocaleString()} {CUR}
                    </span>
                    <button className="obtn" onClick={() => setShowPay(order)}
                      style={{ background: "#e65100", color: "#fff", fontSize: 13, padding: "8px 18px" }}>
                      💰 تسديد
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* سجل الكاش */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#4caf50", marginBottom: 10 }}>
                ✓ المسدَّد اليوم
              </div>
              {outdoorCash.slice(0, 20).map((e, i) => (
                <div key={e.id || i} style={{ display: "flex", justifyContent: "space-between",
                  padding: "8px 12px", background: "#0d2137", borderRadius: 8, marginBottom: 6,
                  border: "1px solid #1a3a5c", fontSize: 13 }}>
                  <span style={{ color: "#8ab4d4" }}>{e.orderNum || e.orderId}</span>
                  <span style={{ fontWeight: 700, color: "#4caf50" }}>+{(e.amount || 0).toLocaleString()} {CUR}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════ REPORT TAB ════════ */}
        {tab === "report" && (
          <div className="fade-in">
            <h2 style={{ fontSize: 17, fontWeight: 900, marginBottom: 16, color: "#4fc3f7" }}>📊 تقرير الحديقة</h2>

            {/* بطاقات الملخص */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div className="ocard" style={{ textAlign: "center", background: "#0d2137" }}>
                <div style={{ fontSize: 28, marginBottom: 4 }}>💰</div>
                <div style={{ fontSize: 11, color: "#8ab4d4", marginBottom: 4 }}>إجمالي الحديقة</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#4fc3f7" }}>
                  {outdoorTotal.toLocaleString()} {CUR}
                </div>
              </div>
              <div className="ocard" style={{ textAlign: "center", background: "#0d2137" }}>
                <div style={{ fontSize: 28, marginBottom: 4 }}>📋</div>
                <div style={{ fontSize: 11, color: "#8ab4d4", marginBottom: 4 }}>عدد الطلبات</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#4fc3f7" }}>
                  {receipts.length}
                </div>
              </div>
              <div className="ocard" style={{ textAlign: "center", background: "#0a1e10", border: "1px solid #1b5e20" }}>
                <div style={{ fontSize: 28, marginBottom: 4 }}>🤝</div>
                <div style={{ fontSize: 11, color: "#8ab4d4", marginBottom: 4 }}>حصة الشريك (⅓)</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#4caf50" }}>
                  {partnerShare.toLocaleString()} {CUR}
                </div>
              </div>
              <div className="ocard" style={{ textAlign: "center", background: "#0a1028", border: "1px solid #1a3a8c" }}>
                <div style={{ fontSize: 28, marginBottom: 4 }}>☕</div>
                <div style={{ fontSize: 11, color: "#8ab4d4", marginBottom: 4 }}>حصة الكافيه (⅔)</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#42a5f5" }}>
                  {myShare.toLocaleString()} {CUR}
                </div>
              </div>
            </div>

            {/* آخر الفواتير */}
            <div style={{ fontSize: 13, fontWeight: 800, color: "#8ab4d4", marginBottom: 10 }}>آخر الفواتير</div>
            {receipts.slice(0, 15).map((r, i) => (
              <div key={r.id || i} className="ocard" style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>#{r.orderNum}</div>
                  <div style={{ fontSize: 11, color: "#8ab4d4" }}>
                    {r.tableNum} — {new Date(r.createdAt).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div style={{ fontWeight: 900, color: "#4caf50", fontSize: 15 }}>
                  {(r.total || 0).toLocaleString()} {CUR}
                </div>
              </div>
            ))}
            {receipts.length === 0 && (
              <div className="ocard" style={{ textAlign: "center", color: "#8ab4d4", padding: 24 }}>
                لا توجد فواتير بعد
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── نافذة التسديد — كاملة مثل الكاش الرئيسي ── */}
      {/* v26: تأكيد تحرير الطاولة (مع إلغاء الطلب المعلّق وسببه) */}
      {releaseModal && releaseModal.order && releaseModal.order.status === "pending" && (
        <CancelOrderModal order={releaseModal.order} cur={CUR}
          onConfirm={(reason) => {
            const ord = releaseModal.order, tb = releaseModal.table;
            restoreOrderStock(store, ord);
            store.setOrders(p => p.map(o => o.id === ord.id ? { ...o, status: "cancelled", cancelReason: reason || "" } : o));
            store.setOutdoorTables(p => p.map(x => x.id === tb.id ? { ...x, status: "free", orderId: null, openedAt: null } : x));
            logActivity({ action: "إلغاء طلب", details: reason || "تحرير طاولة حديقة", userName: user.name, userRole: user.role, orderNum: ord.orderNum, amount: ord.total, branch: "outdoor" });
            showToast("تم تحرير الطاولة وإرجاع المخزون", "warn");
            setReleaseModal(null);
          }}
          onClose={() => setReleaseModal(null)} />
      )}
      {/* تحرير طاولة بلا طلب معلّق — تأكيد بسيط */}
      {releaseModal && (!releaseModal.order || releaseModal.order.status !== "pending") && (
        <div onClick={e => { if (e.target === e.currentTarget) setReleaseModal(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 340 }}>
            <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>تحرير {releaseModal.table.label}؟</div>
            <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 14 }}>ستعود الطاولة لحالة شاغرة.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setReleaseModal(null)} style={{ flex: 1, background: "var(--card2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>تراجع</button>
              <button onClick={() => { const tb = releaseModal.table; store.setOutdoorTables(p => p.map(x => x.id === tb.id ? { ...x, status: "free", orderId: null, openedAt: null } : x)); showToast("تم تحرير الطاولة", "warn"); setReleaseModal(null); }} style={{ flex: 2, background: "#37474f", color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>✓ تحرير</button>
            </div>
          </div>
        </div>
      )}
      {/* حذف طاولة حديقة — تأكيد بسيط (بدل window.confirm المعطّل في WebView) */}
      {delTableModal && (
        <div onClick={e => { if (e.target === e.currentTarget) setDelTableModal(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 340, border: "2px solid #c62828" }}>
            <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6, color: "#ff5252" }}>🗑 حذف {delTableModal.table.label}؟</div>
            <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 14 }}>لا يمكن التراجع عن حذف الطاولة.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setDelTableModal(null)} style={{ flex: 1, background: "var(--card2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>تراجع</button>
              <button onClick={() => { const tb = delTableModal.table; store.setOutdoorTables(p => p.filter(x => x.id !== tb.id)); if (SUPABASE_READY) sbDelete("tables", tb.id); setDelTableModal(null); showToast("تم حذف الطاولة", "warn"); }} style={{ flex: 2, background: "#c62828", color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>🗑 حذف</button>
            </div>
          </div>
        </div>
      )}

      {compConfirm && (
        <div onClick={e => { if (e.target === e.currentTarget) setCompConfirm(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 340 }}>
            <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>🎁 ضيافة كامل الطلب؟</div>
            <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 14 }}>الطلب #{compConfirm.orderNum} — {Number(compConfirm.total||0).toLocaleString()} {CUR} بلا مقابل.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setCompConfirm(null)} style={{ flex: 1, background: "var(--card2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, padding: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>تراجع</button>
              <button onClick={() => { compOrder(compConfirm); setCompConfirm(null); setShowPay(null); }} style={{ flex: 2, background: "#00897b", color: "#fff", border: "none", borderRadius: 10, padding: "11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>🎁 تأكيد الضيافة</button>
            </div>
          </div>
        </div>
      )}
      {showPay && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 999,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }} onClick={e => { if (e.target === e.currentTarget) { setShowPay(null); setPayMode("pay"); setPayTronInput(""); setPayDebtName(""); } }}>
          <div style={{ background: "#0d2137", borderRadius: 20, padding: 24, width: "100%", maxWidth: 380,
            border: "1px solid #1a3a5c", boxShadow: "0 24px 60px rgba(0,0,0,.6)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 36, marginBottom: 4 }}>💰</div>
              <h2 style={{ fontSize: 18, fontWeight: 900, color: "#4fc3f7" }}>تسديد {showPay.orderNum}</h2>
              <div style={{ fontSize: 13, color: "#8ab4d4", marginTop: 4 }}>{showPay.table}</div>
            </div>
            <div style={{ background: "#091525", borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
              {showPay.items?.map((it, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12,
                  padding: "3px 0", borderBottom: i < showPay.items.length - 1 ? "1px solid #1a3a5c" : "none" }}>
                  <span style={{ color: "#8ab4d4" }}>{it.emoji} {it.itemName} ×{it.qty}</span>
                  <span style={{ fontWeight: 700, color: "#4fc3f7" }}>{(it.price * it.qty).toLocaleString()} {CUR}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8,
                fontSize: 17, fontWeight: 900, color: "#4fc3f7" }}>
                <span>الإجمالي</span>
                <span>{showPay.total.toLocaleString()} {CUR}</span>
              </div>
            </div>

            {payMode === "pay" ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#8ab4d4", marginBottom: 8 }}>طريقة الدفع</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {[["cash", "💵 نقدي"], ["card", "💳 بطاقة"], ["tron", "💠 ترون"]].map(([v, label]) => (
                    <button key={v} className="obtn" onClick={() => setPayType(v)}
                      style={{ flex: 1, background: payType === v ? "#4fc3f7" : "#1a3a5c",
                        color: payType === v ? "#000" : "#e8f4fd", fontSize: 13 }}>
                      {label}
                    </button>
                  ))}
                </div>
                {payType === "tron" && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, color: "#8ab4d4", display: "block", marginBottom: 4 }}>مبلغ الترون ({CUR})</label>
                    <input className="oinput" type="number" min="0" value={payTronInput}
                      onChange={e => setPayTronInput(e.target.value)} placeholder="0"
                      style={{ textAlign: "center", fontWeight: 900, fontSize: 16 }} />
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button className="obtn" onClick={() => { setShowPay(null); setPayType("cash"); setPayTronInput(""); }}
                    style={{ flex: 1, background: "#1a3a5c", color: "#8ab4d4" }}>إلغاء</button>
                  <button className="obtn" disabled={isPaying}
                    onClick={() => payOrder(showPay, payType, payType === "tron" ? (+payTronInput || 0) : 0)}
                    style={{ flex: 2, background: "#1b5e20", color: "#fff", fontSize: 15, opacity: isPaying ? .6 : 1, cursor: isPaying ? "wait" : "pointer" }}>
                    {isPaying ? "⏳ جارٍ التسديد..." : "✓ تأكيد التسديد"}
                  </button>
                </div>
                {/* خيارات إضافية: دين / ضيافة */}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button className="obtn" onClick={() => setPayMode("debt")}
                    style={{ flex: 1, background: "rgba(106,27,154,.25)", color: "#ce93d8", fontSize: 12, border: "1px solid rgba(106,27,154,.4)" }}>
                    💳 تسجيل دين
                  </button>
                  <button className="obtn" onClick={() => setCompConfirm(showPay)}
                    style={{ flex: 1, background: "rgba(0,137,123,.25)", color: "#80cbc4", fontSize: 12, border: "1px solid rgba(0,137,123,.4)" }}>
                    🎁 ضيافة كاملة
                  </button>
                </div>
              </>
            ) : (
              // ── وضع تسجيل الدين ──
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#ce93d8", marginBottom: 8 }}>💳 تسجيل دين</div>
                <label style={{ fontSize: 12, color: "#8ab4d4", display: "block", marginBottom: 4 }}>اسم الزبون (إلزامي)</label>
                <input className="oinput" value={payDebtName} autoFocus
                  onChange={e => setPayDebtName(e.target.value)} placeholder="اسم الزبون"
                  style={{ marginBottom: 12 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="obtn" onClick={() => { setPayMode("pay"); setPayDebtName(""); }}
                    style={{ flex: 1, background: "#1a3a5c", color: "#8ab4d4" }}>← رجوع</button>
                  <button className="obtn" onClick={() => {
                    if (!payDebtName.trim()) { showToast("أدخل اسم الزبون", "error"); return; }
                    debtOrder(showPay, payDebtName.trim()); setPayMode("pay"); setPayDebtName("");
                  }} style={{ flex: 2, background: "#6a1b9a", color: "#fff", fontSize: 15 }}>
                    ✓ تأكيد الدين
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
