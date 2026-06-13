// src/Features.jsx — Nardeen Caffe v7
// ══════════════════════════════════════════════════════════════
// مكونات الميزات الجديدة:
//   1. KitchenDisplayTab — شاشة عرض المطبخ (KDS)
//   8. ShiftCloseTab — تقفيل الوردية الرقمي
// (نظام الولاء 6 مدمج داخل CashierTab في App.jsx)
// ══════════════════════════════════════════════════════════════
import React, { useState, useEffect, useMemo, useRef } from "react";
import { SUPABASE_READY, sbDelete, logActivity } from "./lib/supabase.js";
import { notifyTelegram, buildShiftReport, buildDailySummary, buildWeeklySummary } from "./lib/telegram.js";
import {
  getOrderUrgency, getAvgPrepTime, calcShiftSummary, playOrderAlert, businessDayStart, businessDayLabel, weekStartThursday } from "./lib/utils.js";

// ══════════════════════════════════════════════════════════════
// 1. KITCHEN DISPLAY SYSTEM (KDS)
// شاشة تعرض الطلبات النشطة تلقائياً بألوان حسب وقت الانتظار
// ══════════════════════════════════════════════════════════════
export function KitchenDisplayTab({ store, user, showToast, addNotification, settings }) {
  const CUR = settings?.currency || "ل.س";
  const [now, setNow] = useState(Date.now());
  const [station, setStation] = useState("all"); // all | bar | hookah
  const prevCount = useRef(0);

  // ساعة حية كل 10 ثوانٍ لإعادة حساب الألوان
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  // الأصناف حسب الفرع
  const catMatch = (cat) => {
    if (station === "all") return true;
    if (station === "bar") return ["hot_drinks", "cold_drinks", "food"].includes(cat);
    if (station === "hookah") return cat === "hookah";
    return true;
  };

  // الطلبات النشطة (pending + preparing)
  const activeOrders = useMemo(() => {
    return (store.orders || [])
      .filter(o => ["pending", "preparing"].includes(o.status))
      .map(o => {
        const items = (o.items || []).filter(it => {
          const m = store.menu.find(x => x.id === it.itemId);
          return m ? catMatch(m.category) : true;
        });
        return { ...o, _filteredItems: items };
      })
      .filter(o => o._filteredItems.length > 0)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }, [store.orders, store.menu, station, now]);

  // تنبيه صوتي عند طلب جديد
  useEffect(() => {
    if (activeOrders.length > prevCount.current && prevCount.current !== 0) {
      if (settings?.soundEnabled) playOrderAlert(settings?.soundTone || "bell");
    }
    prevCount.current = activeOrders.length;
  }, [activeOrders.length]);

  const avgPrep = getAvgPrepTime(store.orders || []);
  const kdsRef = useRef(null);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFullscreen = () => {
    const el = kdsRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
    }
  };

  const advanceOrder = (order) => {
    const isOutdoor = order.branch === "outdoor";
    if (order.status === "pending") {
      store.setOrders(p => p.map(o => o.id === order.id
        ? { ...o, status: "preparing", preparingAt: new Date().toISOString() }
        : o));
      showToast(`▶ بدأ تحضير #${order.orderNum}`);
    } else if (order.status === "preparing") {
      store.setOrders(p => p.map(o => o.id === order.id
        ? { ...o, status: "ready", readyAt: new Date().toISOString() }
        : o));
      if (addNotification) {
        addNotification(`✅ طلب #${order.orderNum} جاهز`, ["cashier", "admin", "worker"], order.id);
      }
      showToast(`✅ #${order.orderNum} جاهز`);
    }
  };

  const thresholds = {
    warn: settings?.kdsWarnMinutes ?? 5,
    danger: settings?.kdsDangerMinutes ?? 10,
  };

  return (
    <div className="fade-in" ref={kdsRef} style={{ background: isFs ? "var(--bg)" : "transparent", minHeight: isFs ? "100vh" : "auto", padding: isFs ? 18 : 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900 }}>🖥️ شاشة المطبخ (KDS)</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--sub)", background: "var(--card2)", borderRadius: 8, padding: "5px 10px" }}>
            ⏱ متوسط التحضير: <strong>{avgPrep} د</strong>
          </span>
          <span style={{ fontSize: 12, color: "#2e7d32", background: "rgba(46,125,50,.12)", borderRadius: 8, padding: "5px 10px", fontWeight: 700 }}>
            {activeOrders.length} طلب نشط
          </span>
          <button onClick={toggleFullscreen}
            style={{ fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", borderRadius: 8, padding: "5px 12px",
              background: "var(--grad-primary)", color: "#fff" }}>
            {isFs ? "🗗 خروج" : "⛶ ملء الشاشة"}
          </button>
        </div>
      </div>

      {/* فلتر الفرع */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["all", "🍽 الكل"], ["bar", "🥤 البار"], ["hookah", "💨 الأراكيل"]].map(([v, l]) => (
          <button key={v} onClick={() => setStation(v)}
            style={{
              padding: "8px 18px", borderRadius: 20, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
              background: station === v ? "#c62828" : "var(--card2)", color: station === v ? "#fff" : "var(--sub)",
            }}>
            {l}
          </button>
        ))}
      </div>

      {!activeOrders.length ? (
        <div className="card" style={{ textAlign: "center", padding: 60, color: "var(--sub)" }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>لا توجد طلبات قيد التحضير</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>كل الطلبات منتهية — عمل رائع!</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14 }}>
          {activeOrders.map(order => {
            const urgency = getOrderUrgency(order.createdAt, thresholds);
            const isOutdoor = order.branch === "outdoor";
            return (
              <div key={order.id} style={{
                background: "var(--card)", borderRadius: 16, overflow: "hidden",
                boxShadow: urgency.level === "danger" ? `0 0 0 3px ${urgency.color}` : "var(--shadow)",
                animation: urgency.level === "danger" ? "pulse 1.5s infinite" : "none",
                border: `1px solid var(--border)`,
              }}>
                {/* رأس البطاقة */}
                <div style={{ background: urgency.color, color: "#fff", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 900, fontSize: 16 }}>
                    #{order.orderNum}
                    {isOutdoor && <span style={{ fontSize: 11, marginRight: 6, background: "rgba(255,255,255,.25)", borderRadius: 6, padding: "2px 6px" }}>🌿 حديقة</span>}
                  </span>
                  <span style={{ fontWeight: 900, fontSize: 14 }}>⏱ {urgency.minutes} د</span>
                </div>

                <div style={{ padding: 14 }}>
                  {order.table && (
                    <div style={{ fontSize: 12, color: "#1565c0", fontWeight: 700, marginBottom: 8 }}>
                      🪑 {order.table}
                    </div>
                  )}
                  {order._filteredItems.map((it, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: i < order._filteredItems.length - 1 ? "1px dashed var(--border)" : "none" }}>
                      <span style={{ fontSize: 20 }}>{it.emoji}</span>
                      <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{it.itemName}</span>
                      <span style={{ fontWeight: 900, color: urgency.color, fontSize: 18 }}>×{it.qty}</span>
                    </div>
                  ))}

                  {order.notes && (
                    <div style={{ background: "rgba(249,168,37,.12)", borderRadius: 8, padding: "6px 10px", fontSize: 12, color: "#e65100", marginTop: 8 }}>
                      📝 {order.notes}
                    </div>
                  )}

                  <div style={{ marginTop: 12 }}>
                    {order.status === "pending" && (
                      <button onClick={() => advanceOrder(order)}
                        style={{ width: "100%", background: "#1565c0", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
                        ▶ بدء التحضير
                      </button>
                    )}
                    {order.status === "preparing" && (
                      <button onClick={() => advanceOrder(order)}
                        style={{ width: "100%", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 10, padding: "10px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
                        ✅ جاهز للتقديم
                      </button>
                    )}
                  </div>

                  {order.status === "preparing" && (
                    <div style={{ textAlign: "center", fontSize: 11, color: "#1976d2", marginTop: 6, fontWeight: 700 }}>
                      👨‍🍳 قيد التحضير
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 8. SHIFT CLOSE — تقفيل الوردية الرقمي
// ══════════════════════════════════════════════════════════════
export function ShiftCloseTab({ store, user, showToast, dm, settings }) {
  const CUR = settings?.currency || "ل.س";
  const [branch, setBranch] = useState("main");
  const [openingCash, setOpeningCash] = useState("");
  const [shiftType, setShiftType] = useState(""); // v31.6: بلا افتراضي — يُجبَر الكاشير على الاختيار
  const [confirmType, setConfirmType] = useState(false);  // تأكيد توقيت الوردية
  const [countedCash, setCountedCash] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const isAdmin = user?.role === "admin"; // v30.1: حذف/تعديل الورديات المقفلة (أدمن فقط)
  const [editShift, setEditShift] = useState(null);
  const [editCounted, setEditCounted] = useState("");
  const [delShift, setDelShift] = useState(null);

  const saveShiftEdit = () => {
    if (!editShift) return;
    const counted = Math.max(0, +editCounted || 0);
    const difference = counted - (editShift.expectedCash || 0);
    store.setShifts(p => p.map(s => s.id === editShift.id ? { ...s, countedCash: counted, difference } : s));
    try { logActivity({ action: "تعديل وردية مقفلة", details: `${editShift.userName} — معدود ${editShift.countedCash||0}→${counted}`, userName: user?.name || "", userRole: "admin", amount: counted, branch: editShift.branch || "main" }); } catch {}
    showToast("✓ صُحّحت قيمة المعدود", "success"); setEditShift(null); setEditCounted("");
  };
  const doDeleteShift = () => {
    if (!delShift) return;
    store.setShifts(p => p.filter(s => s.id !== delShift.id));
    if (SUPABASE_READY) { try { sbDelete("shifts", delShift.id); } catch {} }
    try { logActivity({ action: "حذف وردية مقفلة", details: `${delShift.userName} — ${new Date(delShift.closedAt||delShift.openedAt).toLocaleString("ar-SY")}`, userName: user?.name || "", userRole: "admin", amount: delShift.countedCash || 0, branch: delShift.branch || "main" }); } catch {}
    showToast("🗑 حُذف سجل الوردية", "warn"); setDelShift(null);
  };

  // الوردية المفتوحة الحالية لهذا الفرع
  const openShift = useMemo(() =>
    (store.shifts || []).find(s => s.status === "open" && s.branch === branch),
    [store.shifts, branch]
  );

  // ملخص لحظي للوردية الحالية
  const summary = useMemo(() => {
    if (!openShift) return null;
    return calcShiftSummary(store.orders, store.expenses, openShift.id, openShift.openedAt, branch);
  }, [openShift, store.orders, store.expenses, branch]);

  const openNewShift = () => {
    const oc = Math.max(0, +openingCash || 0);
    const newShift = {
      id: "shift_" + Date.now(),
      userId: user.id, userName: user.name, branch,
      shiftType, // v31.2: مسائي/ليلي/صباحي
      openedAt: new Date().toISOString(),
      closedAt: null, openingCash: oc,
      status: "open", notes: "",
      createdAt: new Date().toISOString(),
    };
    store.setShifts(p => [newShift, ...p]);
    setOpeningCash(""); setConfirmType(false);
    const tLabel = shiftType === "evening" ? "مسائية" : shiftType === "night" ? "ليلية" : "صباحية";
    showToast(`🔓 فُتحت وردية ${tLabel} — ${branch === "outdoor" ? "الحديقة" : "الكافيه"}`);
  };

  const closeShift = () => {
    if (!openShift || !summary) return;
    const counted = Math.max(0, +countedCash || 0);
    const expectedCash = (openShift.openingCash || 0) + summary.cashSales + (summary.debtSettledCash || 0) - summary.expensesTotal; // v31.6: + نقد سداد الديون
    const difference = counted - expectedCash;

    const closed = {
      ...openShift,
      closedAt: new Date().toISOString(),
      countedCash: counted,
      expectedCash,
      difference,
      cashSales: summary.cashSales,
      cardSales: summary.cardSales,
      tronSales: summary.tronSales,
      debtTotal: summary.debtTotal,
      compTotal: summary.compTotal,
      totalSales: summary.totalSales,
      ordersCount: summary.ordersCount,
      expensesTotal: summary.expensesTotal,
      status: "closed",
      notes,
    };
    store.setShifts(p => p.map(s => s.id === openShift.id ? closed : s));

    // v27: إرسال صامت لتليجرام — التقرير محفوظ في shifts بالفعل (شبكة أمان)
    try {
      const cafeName = settings?.cafeName || "ناردين كافيه";
      const targets = settings?.telegramTargets || [];
      notifyTelegram(targets, "shift", buildShiftReport(closed, cafeName, CUR));

      // v31.2: ملخص اليوم يُرسل عند إغلاق الوردية المسائية فقط (لا بالساعة)
      const isEveningClose = openShift.shiftType === "evening"; // v31.6: صريح فقط
      if (isEveningClose) {
        const today = businessDayStart();
        const inToday = (iso) => iso && new Date(iso) >= today;
        const paidToday = (store.orders || []).filter(o => o.status === "paid" && inToday(o.paidAt || o.createdAt));
        const sum = (a, f = o => o.total || 0) => a.reduce((s, o) => s + f(o), 0);
        const expToday = (store.expenses || []).filter(e => !e.isSecondary && !e.isComplimentary && inToday(e.date)).reduce((s, e) => s + (e.amount || 0), 0);
        const costToday = paidToday.reduce((s, o) => s + (o.items || []).reduce((a, it) => {
          const m = (store.menu || []).find(x => x.id === it.itemId);
          return a + ((m?.cost || 0) * (it.qty || 0));
        }, 0), 0);
        const revenue = sum(paidToday);
        const daily = {
          revenue, cash: sum(paidToday.filter(o => o.paymentType === "cash")),
          card: sum(paidToday.filter(o => o.paymentType === "card")),
          tron: sum(paidToday, o => o.tronAmount || 0),
          expenses: expToday,
          debts: sum((store.orders || []).filter(o => o.status === "debt" && inToday(o.createdAt))),
          comp: (store.orders || []).filter(o => inToday(o.paidAt || o.createdAt)).reduce((a, o) => a + (o.compAmount || 0), 0), // v31.6: كل طلبات اليوم
          profit: revenue - costToday - expToday,
          orders: paidToday.length,
          dayLabel: businessDayLabel(),
        };
        notifyTelegram(targets, "daily", buildDailySummary(daily, cafeName, CUR));

        // v31.2: التقرير الأسبوعي — بعد اليومي، يوم الخميس فقط، مرة واحدة لكل أسبوع
        if (new Date().getDay() === 4) { // 4 = الخميس
          const wkStart = weekStartThursday();
          const wkKey = wkStart.toISOString().slice(0, 10);
          const lastWk = settings?.lastWeeklySent || "";
          if (lastWk !== wkKey) {
            const inWeek = (iso) => iso && new Date(iso) >= wkStart;
            const paidWk = (store.orders || []).filter(o => o.status === "paid" && inWeek(o.paidAt || o.createdAt));
            const expWk = (store.expenses || []).filter(e => !e.isSecondary && !e.isComplimentary && inWeek(e.date)).reduce((s, e) => s + (e.amount || 0), 0);
            const costWk = paidWk.reduce((s, o) => s + (o.items || []).reduce((a, it) => {
              const m = (store.menu || []).find(x => x.id === it.itemId);
              return a + ((m?.cost || 0) * (it.qty || 0));
            }, 0), 0);
            const revWk = sum(paidWk);
            const weekly = {
              revenue: revWk, expenses: expWk,
              profit: revWk - costWk - expWk,
              orders: paidWk.length,
              cash: sum(paidWk.filter(o => o.paymentType === "cash")),
              card: sum(paidWk.filter(o => o.paymentType === "card")),
              debts: sum((store.orders || []).filter(o => o.status === "debt" && inWeek(o.createdAt))),
              comp: (store.orders || []).filter(o => inWeek(o.paidAt || o.createdAt)).reduce((a, o) => a + (o.compAmount || 0), 0), // v31.6
              fromLabel: wkStart.toLocaleDateString("ar-SY", { day: "numeric", month: "long" }),
              toLabel: new Date().toLocaleDateString("ar-SY", { day: "numeric", month: "long" }),
            };
            notifyTelegram(targets, "weekly", buildWeeklySummary(weekly, cafeName, CUR));
            try { store.setSettings({ ...settings, lastWeeklySent: wkKey }); } catch {}
          }
        }
      }
    } catch (e) { console.warn("telegram shift:", e); }

    setCountedCash("");
    setNotes("");
    setConfirmClose(false);

    if (Math.abs(difference) < 1) {
      showToast("✅ أُقفلت الوردية — الصندوق مطابق تماماً");
    } else if (difference > 0) {
      showToast(`⚠ أُقفلت الوردية — زيادة ${difference.toLocaleString()} ${CUR}`, "warn");
    } else {
      showToast(`⚠ أُقفلت الوردية — عجز ${Math.abs(difference).toLocaleString()} ${CUR}`, "error");
    }
  };

  const expectedCash = openShift && summary
    ? (openShift.openingCash || 0) + summary.cashSales + (summary.debtSettledCash || 0) - summary.expensesTotal
    : 0;
  const liveDiff = (+countedCash || 0) - expectedCash;

  // سجل الورديات المقفلة
  const closedShifts = useMemo(() =>
    (store.shifts || [])
      .filter(s => s.status === "closed" && s.branch === branch)
      .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
      .slice(0, 10),
    [store.shifts, branch]
  );

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 16 }}>🔐 تقفيل الوردية</h2>

      {/* اختيار الفرع */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {[["main", "☕ الكافيه"], ["outdoor", "🌿 الحديقة"]].map(([v, l]) => (
          <button key={v} onClick={() => setBranch(v)}
            style={{
              padding: "8px 20px", borderRadius: 20, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
              background: branch === v ? "#c62828" : "var(--card2)", color: branch === v ? "#fff" : "var(--sub)",
            }}>
            {l}
          </button>
        ))}
      </div>

      {!openShift ? (
        // ── فتح وردية جديدة ──
        <div className="card" style={{ maxWidth: 440, marginBottom: 24 }}>
          <div style={{ textAlign: "center", fontSize: 44, marginBottom: 10 }}>🔓</div>
          <h3 style={{ textAlign: "center", fontWeight: 900, marginBottom: 6 }}>فتح وردية جديدة</h3>
          <p style={{ textAlign: "center", fontSize: 13, color: "var(--sub)", marginBottom: 16 }}>
            لا توجد وردية مفتوحة لـ {branch === "outdoor" ? "الحديقة" : "الكافيه"}
          </p>
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", marginBottom: 6, display: "block" }}>
            نوع الوردية
          </label>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[["evening", "🌆 مسائية"], ["night", "🌙 ليلية"], ["morning", "☀️ صباحية"]].map(([v, l]) => (
              <button key={v} onClick={() => setShiftType(v)}
                style={{ flex: 1, padding: "10px 6px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap",
                  border: shiftType === v ? "none" : "1.5px solid var(--border)",
                  background: shiftType === v ? "#1565c0" : "transparent",
                  color: shiftType === v ? "#fff" : "var(--sub)" }}>{l}</button>
            ))}
          </div>
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", marginBottom: 6, display: "block" }}>
            النقد الافتتاحي في الصندوق ({CUR})
          </label>
          <input className="input" type="number" min="0" value={openingCash}
            onChange={e => setOpeningCash(e.target.value)} placeholder="0"
            style={{ fontSize: 20, fontWeight: 900, textAlign: "center", marginBottom: 14 }} />
          <button onClick={() => { if (!shiftType) { showToast("اختر نوع الوردية أولاً", "warn"); return; } setConfirmType(true); }}
            style={{ width: "100%", background: shiftType ? "#2e7d32" : "#999", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontWeight: 800, fontSize: 15, cursor: shiftType ? "pointer" : "not-allowed" }}>
            🔓 فتح الوردية
          </button>

          {confirmType && (
            <div onClick={() => setConfirmType(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 340, textAlign: "center" }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>{shiftType === "evening" ? "🌆" : shiftType === "night" ? "🌙" : "☀️"}</div>
                <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>تأكيد توقيت الوردية</h3>
                <p style={{ fontSize: 14, color: "var(--sub)", marginBottom: 4 }}>هل أنت متأكد أنها وردية <b style={{ color: "var(--text)" }}>{shiftType === "evening" ? "مسائية" : shiftType === "night" ? "ليلية" : "صباحية"}</b>؟</p>
                <p style={{ fontSize: 11, color: "#e65100", marginBottom: 16 }}>⚠ الوردية المسائية هي التي تُرسل تقرير اليوم — لا تختر النوع الخطأ.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setConfirmType(false)} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700 }}>لا</button>
                  <button onClick={openNewShift} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "#2e7d32", color: "#fff", fontWeight: 800 }}>نعم، افتح</button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        // ── وردية مفتوحة: عرض الملخص + تقفيل ──
        <>
          <div className="card" style={{ marginBottom: 16, borderTop: "4px solid #2e7d32" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 15 }}>🟢 وردية مفتوحة</div>
                <div style={{ fontSize: 12, color: "var(--sub)" }}>
                  {openShift.userName} • منذ {new Date(openShift.openedAt).toLocaleString("ar-SY", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
                </div>
              </div>
              <div style={{ fontSize: 13, background: "var(--card2)", borderRadius: 8, padding: "6px 12px" }}>
                افتتاحي: <strong>{(openShift.openingCash || 0).toLocaleString()} {CUR}</strong>
              </div>
            </div>

            {/* بطاقات الملخص */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
              {[
                ["💵", "مبيعات نقدية", summary?.cashSales || 0, "#2e7d32"],
                ["💳", "بطاقة", summary?.cardSales || 0, "#1565c0"],
                ["💠", "ترون", summary?.tronSales || 0, "#6a1b9a"],
                ["📋", "ديون", summary?.debtTotal || 0, "#e65100"],
                ["🎁", "ضيافة", summary?.compTotal || 0, "#00897b"],
                ["📒", "مصاريف", summary?.expensesTotal || 0, "#c62828"],
              ].map(([icon, label, val, color]) => (
                <div key={label} style={{ background: "var(--card2)", borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 18 }}>{icon}</div>
                  <div style={{ fontSize: 10, color: "var(--sub)" }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color }}>{val.toLocaleString()}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 14, padding: "12px 16px", background: "rgba(46,125,50,.08)", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>💰 النقد المتوقع في الصندوق</span>
              <span style={{ fontWeight: 900, fontSize: 18, color: "#2e7d32" }}>{expectedCash.toLocaleString()} {CUR}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 6, textAlign: "center" }}>
              (افتتاحي {(openShift.openingCash || 0).toLocaleString()} + نقدي {(summary?.cashSales || 0).toLocaleString()} − مصاريف {(summary?.expensesTotal || 0).toLocaleString()})
            </div>
          </div>

          {/* تقفيل الوردية */}
          <div className="card" style={{ marginBottom: 24, borderTop: "4px solid #e65100" }}>
            <h3 style={{ fontWeight: 900, fontSize: 15, marginBottom: 14 }}>🔐 تقفيل الوردية وجرد الصندوق</h3>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", marginBottom: 6, display: "block" }}>
              النقد المعدود فعلياً في الصندوق ({CUR})
            </label>
            <input className="input" type="number" min="0" value={countedCash}
              onChange={e => setCountedCash(e.target.value)} placeholder="0"
              style={{ fontSize: 20, fontWeight: 900, textAlign: "center", marginBottom: 12 }} />

            {countedCash !== "" && (
              <div style={{
                padding: "12px 16px", borderRadius: 12, marginBottom: 14, textAlign: "center",
                background: Math.abs(liveDiff) < 1 ? "rgba(46,125,50,.12)" : liveDiff > 0 ? "rgba(245,158,11,.12)" : "rgba(198,40,40,.12)",
                border: `1.5px solid ${Math.abs(liveDiff) < 1 ? "#2e7d32" : liveDiff > 0 ? "#f59e0b" : "#c62828"}`,
              }}>
                <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 4 }}>الفرق عن المتوقع</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: Math.abs(liveDiff) < 1 ? "#2e7d32" : liveDiff > 0 ? "#e65100" : "#c62828" }}>
                  {Math.abs(liveDiff) < 1 ? "✅ مطابق تماماً" : `${liveDiff > 0 ? "▲ زيادة" : "▼ عجز"} ${Math.abs(liveDiff).toLocaleString()} ${CUR}`}
                </div>
              </div>
            )}

            <textarea className="input" placeholder="ملاحظات (سبب العجز/الزيادة إن وُجد)..."
              value={notes} onChange={e => setNotes(e.target.value)}
              style={{ resize: "none", height: 60, marginBottom: 14 }} />

            {!confirmClose ? (
              <button onClick={() => { if (countedCash === "") { showToast("أدخل النقد المعدود أولاً", "error"); return; } setConfirmClose(true); }}
                style={{ width: "100%", background: "#e65100", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontWeight: 800, fontSize: 15, cursor: "pointer" }}>
                🔐 تقفيل الوردية
              </button>
            ) : (
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={closeShift}
                  style={{ flex: 2, background: "#c62828", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
                  ✓ تأكيد التقفيل النهائي
                </button>
                <button onClick={() => setConfirmClose(false)}
                  style={{ flex: 1, background: "var(--card2)", color: "var(--text)", border: "1.5px solid var(--border)", borderRadius: 12, padding: 14, fontWeight: 700, cursor: "pointer" }}>
                  تراجع
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* سجل الورديات المقفلة */}
      {closedShifts.length > 0 && (
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>📋 سجل الورديات المقفلة</h3>
          {closedShifts.map(s => (
            <div key={s.id} className="card" style={{ marginBottom: 10, borderRight: `4px solid ${Math.abs(s.difference) < 1 ? "#2e7d32" : s.difference > 0 ? "#e65100" : "#c62828"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{s.userName}</div>
                  <div style={{ fontSize: 11, color: "var(--sub)" }}>
                    {new Date(s.openedAt).toLocaleString("ar-SY", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
                    {" ← "}
                    {s.closedAt && new Date(s.closedAt).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <span style={{
                  fontSize: 12, fontWeight: 800, borderRadius: 20, padding: "4px 12px",
                  background: Math.abs(s.difference) < 1 ? "rgba(46,125,50,.15)" : s.difference > 0 ? "rgba(230,81,0,.15)" : "rgba(198,40,40,.15)",
                  color: Math.abs(s.difference) < 1 ? "#2e7d32" : s.difference > 0 ? "#e65100" : "#c62828",
                }}>
                  {Math.abs(s.difference) < 1 ? "✅ مطابق" : s.difference > 0 ? `▲ +${s.difference.toLocaleString()}` : `▼ ${s.difference.toLocaleString()}`}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))", gap: 8, fontSize: 11 }}>
                <div style={{ color: "var(--sub)" }}>المبيعات: <strong style={{ color: "var(--text)" }}>{(s.totalSales || 0).toLocaleString()}</strong></div>
                <div style={{ color: "var(--sub)" }}>متوقع: <strong style={{ color: "var(--text)" }}>{(s.expectedCash || 0).toLocaleString()}</strong></div>
                <div style={{ color: "var(--sub)" }}>معدود: <strong style={{ color: "var(--text)" }}>{(s.countedCash || 0).toLocaleString()}</strong></div>
                <div style={{ color: "var(--sub)" }}>طلبات: <strong style={{ color: "var(--text)" }}>{s.ordersCount || 0}</strong></div>
              </div>
              {s.notes && <div style={{ marginTop: 6, fontSize: 11, color: "#795548", background: "rgba(121,85,72,.08)", borderRadius: 6, padding: "4px 8px" }}>📝 {s.notes}</div>}
              {isAdmin && (
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={() => { setEditShift(s); setEditCounted(String(s.countedCash || "")); }}
                    style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>✏ تصحيح المعدود</button>
                  <button onClick={() => setDelShift(s)}
                    style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "rgba(198,40,40,.15)", color: "#c62828", fontWeight: 700, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>🗑 حذف</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editShift && (
        <div onClick={() => setEditShift(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 340 }}>
            <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 4 }}>✏ تصحيح المعدود</h3>
            <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 14 }}>المتوقع {(editShift.expectedCash || 0).toLocaleString()} {CUR} — يُعاد حساب الفرق تلقائياً.</div>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", display: "block", marginBottom: 4 }}>المعدود فعلياً ({CUR})</label>
            <input className="input" type="number" value={editCounted} onChange={e => setEditCounted(e.target.value)} style={{ marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setEditShift(null)} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700 }}>إلغاء</button>
              <button onClick={saveShiftEdit} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "#1565c0", color: "#fff", fontWeight: 800 }}>حفظ</button>
            </div>
          </div>
        </div>
      )}

      {delShift && (
        <div onClick={() => setDelShift(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="card fade-in" style={{ width: "100%", maxWidth: 340 }}>
            <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 6 }}>🗑 حذف سجل الوردية؟</h3>
            <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 16 }}>{delShift.userName} — {new Date(delShift.closedAt || delShift.openedAt).toLocaleString("ar-SY")}. لا يمكن التراجع.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setDelShift(null)} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700 }}>إلغاء</button>
              <button onClick={doDeleteShift} style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "#c62828", color: "#fff", fontWeight: 800 }}>🗑 حذف نهائي</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
