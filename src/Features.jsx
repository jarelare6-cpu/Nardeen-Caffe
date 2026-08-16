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
import { buildDailyPacket, shouldSendOnClose } from "./lib/dailyReport.js"; // v46
import { DenominationCounter, denominationNote, HandoverPanel, handoverNote } from "./CashierTools.jsx"; // v47
import {
  getOrderUrgency, getAvgPrepTime, calcShiftSummary, playOrderAlert, businessDayStart, workDayStart, businessDayLabel, weekStartThursday, orderCash, orderTron, orderCogs, orderCashFrac, orderSale,
  businessDayKey, businessDayEnd, formatDayKey, closedShiftsOfDay, sumShifts, ordersOfShifts, DAY_START_UTC_HOUR,
  shiftExpectedCash, shiftBusinessDay, openShiftsOfDay } from "./lib/utils.js";

// ══════════════════════════════════════════════════════════════
// 1. KITCHEN DISPLAY SYSTEM (KDS)
// شاشة تعرض الطلبات النشطة تلقائياً بألوان حسب وقت الانتظار
// ══════════════════════════════════════════════════════════════
export function KitchenDisplayTab({ store, user, showToast, addNotification, settings }) {
  const CUR = settings?.currency || "ل.س";
  const [now, setNow] = useState(Date.now());
  const [station, setStation] = useState("all"); // all | bar | hookah
  const [view, setView] = useState("kanban");   // v47: kanban | cards
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
  // v47: نُدخل «جاهز» أيضاً — عامل البار يحتاج أن يرى ما ينتظر التسليم،
  // وإخفاؤه فور الجاهزية كان يجعله ينسى طلباً واقفاً على الطاولة.
  // نكتفي بآخر 45 دقيقة من الجاهز حتى لا يتضخّم العمود.
  const READY_WINDOW_MS = 45 * 60 * 1000;
  const activeOrders = useMemo(() => {
    return (store.orders || [])
      .filter(o => ["pending", "preparing"].includes(o.status)
        || (o.status === "ready" && o.readyAt && Date.now() - new Date(o.readyAt).getTime() < READY_WINDOW_MS))
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

  // v47: أعمدة مسار التحضير — جديد ← قيد التحضير ← جاهز
  const COLUMNS = [
    { key: "pending",   label: "🆕 جديد",        color: "#e65100" },
    { key: "preparing", label: "👨‍🍳 قيد التحضير", color: "#1565c0" },
    { key: "ready",     label: "✅ جاهز",         color: "#2e7d32" },
  ];

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

      {/* v47: تبديل العرض — أعمدة (Kanban) أو بطاقات */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[["kanban", "🗂 أعمدة"], ["cards", "🃏 بطاقات"]].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)}
            style={{
              padding: "6px 16px", borderRadius: 18, border: "none", fontWeight: 800, fontSize: 12, cursor: "pointer",
              fontFamily: "inherit",
              background: view === v ? "#1565c0" : "var(--card2)", color: view === v ? "#fff" : "var(--sub)",
            }}>{l}</button>
        ))}
      </div>

      {!activeOrders.length ? (
        <div className="card" style={{ textAlign: "center", padding: 60, color: "var(--sub)" }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>لا توجد طلبات قيد التحضير</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>كل الطلبات منتهية — عمل رائع!</div>
        </div>
      ) : view === "kanban" ? (
        /* ══════════════════════════════════════════════════════════
           v47 — عرض الأعمدة
           عمود لكل مرحلة: جديد ← قيد التحضير ← جاهز. عامل البار يرى
           مساره كاملاً في نظرة واحدة بدل شبكة بطاقات مختلطة، ويعرف
           فوراً أين يتكدّس العمل. لون كل بطاقة من مؤقّتها، والمتأخّر
           فوق حدّ الخطر ينبض بالأحمر.
           ══════════════════════════════════════════════════════════ */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, alignItems: "start" }}>
          {COLUMNS.map(col => {
            const list = activeOrders.filter(o => o.status === col.key);
            const late = list.filter(o => getOrderUrgency(o.createdAt, thresholds).level === "danger").length;
            return (
              <div key={col.key} style={{ background: "var(--card2)", borderRadius: 14, padding: 10, minHeight: 120 }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
                  paddingBottom: 8, marginBottom: 8, borderBottom: `2px solid ${col.color}`,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: col.color }}>{col.label}</span>
                  <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
                    {late > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 900, background: "#c62828", color: "#fff", borderRadius: 7, padding: "1px 6px" }}>
                        {late} متأخّر
                      </span>
                    )}
                    <span style={{ fontSize: 12, fontWeight: 900, background: col.color, color: "#fff", borderRadius: 9, minWidth: 22, textAlign: "center", padding: "1px 6px" }}>
                      {list.length}
                    </span>
                  </span>
                </div>

                {!list.length ? (
                  <div style={{ textAlign: "center", padding: "18px 0", color: "var(--sub)", fontSize: 11.5 }}>—</div>
                ) : list.map(order => {
                  const u = getOrderUrgency(order.createdAt, thresholds);
                  const isOutdoor = order.branch === "outdoor";
                  const done = order.status === "ready";
                  return (
                    <div key={order.id} style={{
                      background: "var(--card)", borderRadius: 11, marginBottom: 8, overflow: "hidden",
                      border: `1px solid var(--border)`,
                      boxShadow: !done && u.level === "danger" ? `0 0 0 2.5px ${u.color}` : "none",
                      animation: !done && u.level === "danger" ? "pulse 1.5s infinite" : "none",
                    }}>
                      <div style={{
                        background: done ? "#2e7d32" : u.color, color: "#fff", padding: "6px 10px",
                        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6,
                      }}>
                        <span style={{ fontWeight: 900, fontSize: 13 }}>
                          #{order.orderNum}
                          {isOutdoor && <span style={{ fontSize: 9, marginRight: 5, background: "rgba(255,255,255,.25)", borderRadius: 5, padding: "1px 5px" }}>🌿</span>}
                        </span>
                        <span style={{ fontWeight: 900, fontSize: 12 }}>
                          {done ? "✓ جاهز" : `⏱ ${u.minutes}د`}
                        </span>
                      </div>

                      <div style={{ padding: "8px 10px" }}>
                        {order.table && (
                          <div style={{ fontSize: 11, color: "#1565c0", fontWeight: 800, marginBottom: 5 }}>🪑 {order.table}</div>
                        )}
                        {order._filteredItems.map((it, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                            <span style={{ fontSize: 15 }}>{it.emoji}</span>
                            <span style={{ flex: 1, fontWeight: 700, fontSize: 12.5 }}>{it.itemName}</span>
                            <span style={{ fontWeight: 900, color: done ? "#2e7d32" : u.color, fontSize: 15 }}>×{it.qty}</span>
                          </div>
                        ))}
                        {order.notes && (
                          <div style={{ background: "rgba(249,168,37,.14)", borderRadius: 7, padding: "5px 8px", fontSize: 11, color: "#e65100", marginTop: 6, lineHeight: 1.6 }}>
                            📝 {order.notes}
                          </div>
                        )}
                        {order.status !== "ready" && (
                          <button onClick={() => advanceOrder(order)}
                            style={{
                              width: "100%", marginTop: 8, border: "none", borderRadius: 8, padding: "8px",
                              fontWeight: 900, fontSize: 12.5, cursor: "pointer", color: "#fff", fontFamily: "inherit",
                              background: order.status === "pending" ? "#1565c0" : "#2e7d32",
                            }}>
                            {order.status === "pending" ? "▶ بدء التحضير" : "✅ جاهز للتقديم"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14 }}>
          {activeOrders.map(order => {
            const urgency = getOrderUrgency(order.createdAt, thresholds);
            const isOutdoor = order.branch === "outdoor";
            const done = order.status === "ready";
            return (
              <div key={order.id} style={{
                background: "var(--card)", borderRadius: 16, overflow: "hidden",
                boxShadow: !done && urgency.level === "danger" ? `0 0 0 3px ${urgency.color}` : "var(--shadow)",
                animation: !done && urgency.level === "danger" ? "pulse 1.5s infinite" : "none",
                border: `1px solid var(--border)`,
              }}>
                <div style={{ background: done ? "#2e7d32" : urgency.color, color: "#fff", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 900, fontSize: 16 }}>
                    #{order.orderNum}
                    {isOutdoor && <span style={{ fontSize: 11, marginRight: 6, background: "rgba(255,255,255,.25)", borderRadius: 6, padding: "2px 6px" }}>🌿 حديقة</span>}
                  </span>
                  <span style={{ fontWeight: 900, fontSize: 14 }}>{done ? "✓ جاهز" : `⏱ ${urgency.minutes} د`}</span>
                </div>

                <div style={{ padding: 14 }}>
                  {order.table && (
                    <div style={{ fontSize: 12, color: "#1565c0", fontWeight: 700, marginBottom: 8 }}>🪑 {order.table}</div>
                  )}
                  {order._filteredItems.map((it, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: i < order._filteredItems.length - 1 ? "1px dashed var(--border)" : "none" }}>
                      <span style={{ fontSize: 20 }}>{it.emoji}</span>
                      <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{it.itemName}</span>
                      <span style={{ fontWeight: 900, color: done ? "#2e7d32" : urgency.color, fontSize: 18 }}>×{it.qty}</span>
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
  const [countBreakdown, setCountBreakdown] = useState(null); // v47: تفصيل عدّ الفئات
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
  // v46: (s.branch || "main") — المقارنة الصارمة كانت تُخفي أي وردية قديمة
  // بحقل branch فارغ، فتظهر «لا وردية مفتوحة» هنا بينما شاشة الطلبات تراها.
  const openShift = useMemo(() =>
    (store.shifts || []).find(s => s.status === "open" && (s.branch || "main") === branch),
    [store.shifts, branch]
  );
  // v47: آخر وردية مُقفلة على هذا الفرع — مصدر رقم التسليم
  const lastClosedShift = useMemo(() =>
    (store.shifts || [])
      .filter(s => s.status === "closed" && (s.branch || "main") === branch && s.closedAt)
      .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))[0] || null,
    [store.shifts, branch]
  );

  // v44: ورديات مفتوحة على فروع أخرى — كانت غير مرئية من هنا
  const otherOpen = useMemo(() =>
    (store.shifts || []).filter(s => s.status === "open" && (s.branch || "main") !== branch),
    [store.shifts, branch]
  );
  const shiftTypeLabel = (t) => t === "night" ? "ليلية" : t === "evening" ? "مسائية" : t === "morning" ? "صباحية" : "—";
  const [forceClose, setForceClose] = useState(null);
  const [closing, setClosing] = useState(false); // v46: منع النقر المزدوج أثناء انتظار السحابة

  // ══════════════════════════════════════════════════════════════
  // v44: إغلاق إداري لوردية عالقة (أدمن فقط)
  // للورديات المتروكة أو التجريبية التي لا جرد صندوق لها. لا نختلق
  // أرقاماً: المعدود = المتوقع فيصبح الفارق صفراً، ويُوسَم في الملاحظات
  // وسجل النشاط بأنه إغلاق إداري بلا جرد — فلا يُقرأ كإقفال حقيقي.
  // ══════════════════════════════════════════════════════════════
  const doForceClose = () => {
    const sh = forceClose;
    if (!sh) return;
    const sum = calcShiftSummary(store.orders, store.expenses, sh.id, sh.openedAt, sh.branch || "main");
    const expected = shiftExpectedCash(sh.openingCash, sum); // v46: معادلة واحدة مشتركة
    const closedRow = {
      ...sh,
      closedAt: new Date().toISOString(),
      closedById: user.id, closedByName: user.name,
      countedCash: expected, expectedCash: expected, difference: 0,
      cashSales: sum.cashSales, cardSales: sum.cardSales, tronSales: sum.tronSales,
      debtTotal: sum.debtTotal, compTotal: sum.compTotal, totalSales: sum.totalSales,
      ordersCount: sum.ordersCount, expensesTotal: sum.expensesTotal,
      secExpensesTotal: sum.secExpensesTotal,
      debtSettledCash: sum.debtSettledCash || 0,   // v46: كان يدخل المعادلة ولا يُحفَظ
      businessDay: shiftBusinessDay(sh),           // v46: يوم الفتح — سجل ثابت
      status: "closed",
      notes: [(sh.notes || "").trim(), "⚠ إغلاق إداري بلا جرد صندوق"].filter(Boolean).join(" — "),
    };
    store.setShifts(p => p.map(x => x.id === sh.id ? closedRow : x));
    try {
      logActivity({ action: "إغلاق إداري لوردية", details: `${sh.branch === "outdoor" ? "الحديقة" : "الكافيه"} — ${shiftTypeLabel(sh.shiftType)} — بلا جرد صندوق`,
        userName: user.name, userRole: user.role, amount: expected, branch: sh.branch || "main" });
    } catch {}
    showToast("🔒 أُغلقت الوردية إدارياً — بلا جرد صندوق", "warn");
    setForceClose(null);
  };

  // ملخص لحظي للوردية الحالية
  const summary = useMemo(() => {
    if (!openShift) return null;
    return calcShiftSummary(store.orders, store.expenses, openShift.id, openShift.openedAt, branch);
  }, [openShift, store.orders, store.expenses, branch]);

  const openNewShift = () => {
    // ══════════════════════════════════════════════════════════════
    // v43: حارس الوردية المزدوجة
    // جهازان يفتحان وردية على الفرع نفسه في اللحظة ذاتها كان ينتج
    // ورديتين مفتوحتين، فتتوزّع الطلبات بينهما عشوائياً وينهار جرد
    // الصندوق. القاعدة تمنعه بفهرس فريد (هجرة v43)، وهذا الفحص يمنع
    // الحالة قبل وصولها ويعطي رسالة مفهومة بدل خطأ قاعدة بيانات.
    // ══════════════════════════════════════════════════════════════
    const already = (store.shifts || []).find(x => x.status === "open" && (x.branch || "main") === branch);
    if (already) {
      showToast(`⚠ توجد وردية مفتوحة بالفعل (${already.userName || "—"}) — أقفلها أولاً`, "error");
      setConfirmType(false);
      return;
    }
    const oc = Math.max(0, +openingCash || 0);
    const openedAt = new Date().toISOString();
    const newShift = {
      // v46: معرّف يحمل لاحقة عشوائية — "shift_"+Date.now() وحده يمكن أن
      // يتطابق بين جهازين يفتحان في نفس الميلي ثانية، فيدمج الصفّان في القاعدة.
      id: "shift_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      userId: user.id, userName: user.name, branch,
      shiftType, // v31.2: مسائي/ليلي/صباحي
      openedAt,
      // v46: اليوم المحاسبي يُختم لحظة الفتح ويبقى ثابتاً مدى حياة الوردية
      businessDay: businessDayKey(openedAt),
      closedAt: null, openingCash: oc,
      status: "open",
      // v47: أثر التسليم — إن خالف الافتتاحي معدود الوردية السابقة يُسجَّل
      // الفرق باسم المُسلِّم والمُستلِم لحظة وقوعه، فينتهي الجدل اللاحق.
      notes: handoverNote(lastClosedShift, oc, user.name),
      createdAt: openedAt,
    };
    store.setShifts(p => [newShift, ...p]);
    setOpeningCash(""); setConfirmType(false);
    const tLabel = shiftType === "evening" ? "مسائية" : shiftType === "night" ? "ليلية" : "صباحية";
    showToast(`🔓 فُتحت وردية ${tLabel} — ${branch === "outdoor" ? "الحديقة" : "الكافيه"}`);
  };

  // ══════════════════════════════════════════════════════════════
  // v46 — الإقفال بتأكيد فعلي من السحابة
  // ──────────────────────────────────────────────────────────────
  // كانت الدالة متزامنة: تُحدّث الحالة المحلية وتُظهر «✅ أُقفلت الوردية»
  // فوراً، ثم تُطلق كتابة السحابة وتنساها. أي تجاوز للمهلة (10 ثوانٍ)
  // كان يُفقد الإقفال، ويُعيد أول pullAll الوردية مفتوحة — بينما الكاشير
  // انصرف واثقاً من الرسالة. الآن ننتظر الطابور ونقول الحقيقة:
  //   • وصلت السحابة  ⇒ رسالة نجاح مع نتيجة جرد الصندوق.
  //   • لم تصل بعد    ⇒ رسالة صريحة بأن الإقفال محفوظ ومعلّق للمزامنة،
  //     ولا يُعتبر منتهياً حتى تصل. لا رسالة نجاح كاذبة بعد اليوم.
  // ══════════════════════════════════════════════════════════════
  const closeShift = async () => {
    if (!openShift || !summary || closing) return;
    setClosing(true);
    const counted = Math.max(0, +countedCash || 0);
    const expectedCash = shiftExpectedCash(openShift.openingCash, summary); // v46: معادلة مشتركة
    const difference = counted - expectedCash;

    const closed = {
      ...openShift,
      closedAt: new Date().toISOString(),
      // v44: مَن أقفلها فعلاً — قد يختلف عن مَن فتحها، والتقرير يجب أن
      // ينسب العملية لصاحب الحساب الذي نفّذها لا لمن فتح الوردية.
      closedById: user.id,
      closedByName: user.name,
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
      secExpensesTotal: summary.secExpensesTotal, // v40: بند منفصل في التقرير
      // v46: نقد سداد الديون — كان يدخل معادلة المتوقّع ولا يُحفَظ في أي
      // عمود، فيستحيل على أي تقرير لاحق إعادة إنتاج الرقم المعروض للكاشير.
      debtSettledCash: summary.debtSettledCash || 0,
      // v46: اليوم المحاسبي = يوم **الفتح**. يُخزَّن مرة واحدة كسجل ثابت،
      // فلا يتغيّر الجرد التاريخي مهما تغيّرت قواعد الحساب مستقبلاً.
      businessDay: shiftBusinessDay(openShift),
      status: "closed",
      // v47: تفصيل عدّ الفئات يُحفَظ مع الوردية — أثر يُراجَع عند وجود فرق
      notes: [notes.trim(), denominationNote(countBreakdown)].filter(Boolean).join(" — "),
    };
    store.setShifts(p => p.map(s => s.id === openShift.id ? closed : s));

    // ── انتظار تأكيد السحابة قبل أي رسالة نجاح ──────────────────
    let synced = true, offline = false;
    try {
      const res = await store.commitShift(openShift.id);
      synced = res.synced; offline = res.offline;
    } catch { synced = false; }

    // v27: إرسال صامت لتليجرام — التقرير محفوظ في shifts بالفعل (شبكة أمان)
    try {
      const cafeName = settings?.cafeName || "ناردين كافيه";
      const targets = settings?.telegramTargets || [];
      notifyTelegram(targets, "shift", buildShiftReport(closed, cafeName, CUR));

      // ══════════════════════════════════════════════════════════════
      // v46 — الجرد اليومي يُرسَل عند إقفال **آخر** وردية في اليوم
      // ──────────────────────────────────────────────────────────────
      // الشرط السابق كان: openShift.shiftType === "evening". وهو معطوب من
      // جذره لأن عمود shift_type لم يكن موجوداً في قاعدة البيانات إطلاقاً،
      // فتحذفه دالة upsertStrip بصمت وتعود الوردية من السحابة بنوع فارغ ⇒
      // الشرط false دائماً ⇒ الجرد اليومي لا يُرسَل من المسار الأساسي أبداً.
      //
      // البديل وصفي لا اسمي: نرسل حين لا تبقى وردية مفتوحة تنتمي لهذا اليوم
      // المحاسبي. مع تسلسلك (صباحية ← مسائية ← ليلية) يقع ذلك عند إقفال
      // الليلية، وهي فعلاً آخر ورديات اليوم — ويبقى صحيحاً لو نسي الكاشير
      // اختيار النوع أو اختلف عدد الورديات يوماً ما.
      // ══════════════════════════════════════════════════════════════
      const dayKey = shouldSendOnClose(store, settings, closed);
      if (dayKey) {
        const daily = buildDailyPacket(store, dayKey, [closed]);
        notifyTelegram(targets, "daily", buildDailySummary(daily, cafeName, CUR));

        // v46: كل أختام الإرسال في تحديث واحد بصيغة الدالة.
        // كان اليومي يُختم بـ setSettings(p => ...) ثم يُختم الأسبوعي بـ
        // setSettings({ ...settings, ... }) باستخدام settings **القديم**،
        // فيمحو الثاني ختمَ الأول ⇒ شبكة الأمان تُعيد إرسال جرد اليوم مكرراً
        // كل خميس. الآن ختم واحد يحمل الاثنين.
        const stamps = { lastDailySent: dayKey };

        // v31.2: التقرير الأسبوعي — بعد اليومي، يوم الخميس فقط، مرة لكل أسبوع
        if (new Date().getDay() === 4) { // 4 = الخميس
          const wkStart = weekStartThursday();
          const wkKey = wkStart.toISOString().slice(0, 10);
          if ((settings?.lastWeeklySent || "") !== wkKey) {
            const inWeek = (iso) => iso && new Date(iso) >= wkStart;
            const paidWk = (store.orders || []).filter(o => o.status === "paid" && inWeek(o.paidAt || o.createdAt));
            const expWk = (store.expenses || []).filter(e => !e.isSecondary && !e.isComplimentary && inWeek(e.date)).reduce((s, e) => s + (e.amount || 0), 0);
            const secExpWk = (store.expenses || []).filter(e => e.isSecondary && inWeek(e.date)).reduce((s, e) => s + (e.amount || 0), 0);
            const costWk = paidWk.reduce((s, o) => s + orderCogs(o, store.menu), 0);
            const revWk = paidWk.reduce((s, o) => s + orderSale(o), 0);
            const weekly = {
              revenue: revWk, expenses: expWk,
              secExpenses: secExpWk, // بند منفصل — لا يُطرح من الربح
              profit: revWk - costWk - expWk,
              orders: paidWk.length,
              cash: paidWk.filter(o => o.paymentType === "cash").reduce((s, o) => s + orderCash(o), 0),
              card: paidWk.filter(o => o.paymentType === "card").reduce((s, o) => s + orderCash(o), 0),
              tron: paidWk.reduce((s, o) => s + orderTron(o), 0),
              debts: (store.orders || []).filter(o => o.status === "debt" && inWeek(o.createdAt)).reduce((s, o) => s + (o.total || 0), 0),
              comp: (store.orders || []).filter(o => inWeek(o.paidAt || o.createdAt)).reduce((a, o) => a + (o.compAmount || 0), 0),
              fromLabel: wkStart.toLocaleDateString("ar-SY", { day: "numeric", month: "long" }),
              toLabel: new Date().toLocaleDateString("ar-SY", { day: "numeric", month: "long" }),
            };
            notifyTelegram(targets, "weekly", buildWeeklySummary(weekly, cafeName, CUR));
            stamps.lastWeeklySent = wkKey;
          }
        }
        try { store.setSettings(p => ({ ...p, ...stamps })); } catch {}
      }
    } catch (e) { console.warn("telegram shift:", e); }

    setCountedCash("");
    setCountBreakdown(null);
    setNotes("");
    setConfirmClose(false);
    setClosing(false);

    // ── الرسالة تصف الواقع، لا النيّة ───────────────────────────
    if (!synced) {
      showToast(
        offline
          ? "📴 لا اتصال — الإقفال محفوظ وسيُرسَل تلقائياً عند عودة الإنترنت. لا تُغلق التطبيق."
          : "⏳ الإقفال محفوظ لكنه لم يصل السحابة بعد — سيُعاد إرساله تلقائياً. تحقّق من الاتصال.",
        "warn"
      );
      return;
    }
    if (Math.abs(difference) < 1) {
      showToast("✅ أُقفلت الوردية وتأكّدت في السحابة — الصندوق مطابق تماماً");
    } else if (difference > 0) {
      showToast(`⚠ أُقفلت الوردية — زيادة ${difference.toLocaleString()} ${CUR}`, "warn");
    } else {
      showToast(`⚠ أُقفلت الوردية — عجز ${Math.abs(difference).toLocaleString()} ${CUR}`, "error");
    }
  };

  // v46: نفس الدالة المستعملة عند الإقفال — يستحيل أن يختلف المعروض عن المحفوظ
  const expectedCash = openShift && summary ? shiftExpectedCash(openShift.openingCash, summary) : 0;
  const liveDiff = (+countedCash || 0) - expectedCash;

  // ══════════════════════════════════════════════════════════════
  // v41 — حارس حدّ اليوم المحاسبي
  // ──────────────────────────────────────────────────────────────
  // اليوم ينتهي الساعة DAY_START_UTC_HOUR بتوقيت غرينتش (0 UTC = 3:00 فجراً
  // بتوقيت دمشق). جدول العمل يترك هامشاً مريحاً لكل الورديات عدا المسائية:
  // تُقفَل عادةً 1:00–2:00 فجراً محلياً، أي على بُعد ساعة إلى ساعتين من الحدّ.
  // إن تأخّر إقفالها بعد 3:00 فجراً انتقل إيرادها كاملاً إلى جرد الغد،
  // ولم يعد جرد اليوم يشمل الورديات الثلاث. نُنبّه قبل وقوع ذلك.
  // ══════════════════════════════════════════════════════════════
  // v43: عمر الوردية المفتوحة — تنبيه إن تُركت مفتوحة سهواً
  const maxShiftHours = settings?.shiftMaxHours || 12;
  const shiftAge = useMemo(() => {
    if (!openShift?.openedAt) return { hours: 0, tooLong: false };
    const h = (Date.now() - new Date(openShift.openedAt).getTime()) / 3600000;
    return { hours: Math.floor(h), tooLong: h > maxShiftHours };
  }, [openShift, countedCash, maxShiftHours]);

  const dayGuard = useMemo(() => {
    const now = new Date();
    const key = businessDayKey(now);
    const minsLeft = Math.round((businessDayEnd(now).getTime() - now.getTime()) / 60000);
    return { key, minsLeft, near: minsLeft <= 90 };
  }, [countedCash, openShift]);

  // سجل الورديات المقفلة
  const closedShifts = useMemo(() =>
    (store.shifts || [])
      .filter(s => s.status === "closed" && s.branch === branch)
      .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
      .slice(0, 10),
    [store.shifts, branch]
  );

  // ══════════════════════════════════════════════════════════════
  // v46 — كاشف «الهجرة لم تُنفَّذ»
  // ──────────────────────────────────────────────────────────────
  // دالة upsertStrip تحذف أي عمود ناقص بصمت وتُتمّ الكتابة بنجاح ظاهري.
  // النتيجة أن غياب عمود shift_type ظلّ مخفياً إصدارات كاملة بينما كان
  // يُعطّل الجرد اليومي بالكامل. هذا الفحص يجعل الغياب مرئياً فوراً:
  // إن وُجدت ورديات مُقفلة وكلها بلا نوع رغم أن الكاشير يختاره إجبارياً
  // عند الفتح، فالعمود غير موجود في القاعدة.
  // ══════════════════════════════════════════════════════════════
  const migrationMissing = useMemo(() => {
    const closedList = (store.shifts || []).filter(s => s.status === "closed");
    if (closedList.length < 2) return false;
    return closedList.every(s => !s.shiftType) || closedList.every(s => !s.businessDay);
  }, [store.shifts]);

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 16 }}>🔐 تقفيل الوردية</h2>

      {migrationMissing && (
        <div style={{ background: "rgba(198,40,40,.1)", border: "1.5px solid rgba(198,40,40,.4)", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "#c62828", marginBottom: 6 }}>
            ⛔ قاعدة البيانات ناقصة أعمدة — الجرد اليومي معطّل
          </div>
          <div style={{ fontSize: 11.5, color: "var(--sub)", lineHeight: 1.9 }}>
            نوع الوردية واليوم المحاسبي لا يُحفظان (العمودان غير موجودين)، فلا يُرسَل
            الجرد اليومي ولا يُبنى تسلسل الورديات. نفّذ مرة واحدة في Supabase ▸ SQL Editor:
            <br />
            <code style={{ fontSize: 11, fontWeight: 800, color: "#c62828" }}>
              db/migrations/2026-08-16_v46_shift_integrity.sql
            </code>
          </div>
        </div>
      )}

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

      {/* ══════════════════════════════════════════════════════════════
          v44: وردية مفتوحة على فرع آخر
          شاشة التقفيل تعرض وردية الفرع المختار فقط، بينما لوحة التحكم
          تعرض المفتوحة من كل الفروع. فوردية عالقة على الحديقة تبقى حمراء
          في اللوحة وغير مرئية هنا مهما أقفلت ورديات الكافيه.
          ══════════════════════════════════════════════════════════════ */}
      {otherOpen.length > 0 && (
        <div style={{ background: "rgba(230,81,0,.1)", border: "1.5px solid rgba(230,81,0,.35)", borderRadius: 10, padding: "11px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#e65100", marginBottom: 8 }}>
            ⚠ توجد وردية مفتوحة على فرع آخر
          </div>
          {otherOpen.map(sh => (
            <div key={sh.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>
                {sh.branch === "outdoor" ? "🌿 الحديقة" : "☕ الكافيه"} — {shiftTypeLabel(sh.shiftType)}
                <span style={{ color: "var(--sub)", fontWeight: 600, marginRight: 6 }}>
                  (مفتوحة منذ {Math.floor((Date.now() - new Date(sh.openedAt).getTime()) / 3600000)} ساعة)
                </span>
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setBranch(sh.branch || "main")}
                  style={{ background: "#e65100", color: "#fff", border: "none", borderRadius: 8, padding: "6px 14px", fontWeight: 800, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
                  انتقل لإقفالها
                </button>
                {isAdmin && (
                  <button onClick={() => setForceClose(sh)}
                    style={{ background: "transparent", color: "#c62828", border: "1.5px solid rgba(198,40,40,.4)", borderRadius: 8, padding: "6px 12px", fontWeight: 800, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
                    إغلاق إداري
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {forceClose && (
        <div onClick={e => { if (e.target === e.currentTarget) setForceClose(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          <div className="card fade-in" style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔒</div>
            <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>إغلاق إداري</h3>
            <p style={{ fontSize: 12.5, color: "var(--sub)", marginBottom: 6, lineHeight: 1.8 }}>
              {forceClose.branch === "outdoor" ? "🌿 الحديقة" : "☕ الكافيه"} — {shiftTypeLabel(forceClose.shiftType)}
            </p>
            <p style={{ fontSize: 11.5, color: "#e65100", marginBottom: 16, lineHeight: 1.8 }}>
              تُغلَق <b>بلا جرد صندوق</b>: المعدود = المتوقع والفارق صفر، وتُوسَم في
              الملاحظات وسجل النشاط. استعملها للورديات المتروكة أو التجريبية فقط —
              لا للإقفال اليومي.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setForceClose(null)}
                style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>تراجع</button>
              <button onClick={doForceClose}
                style={{ flex: 1, padding: 11, borderRadius: 10, border: "none", background: "#c62828", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>تأكيد</button>
            </div>
          </div>
        </div>
      )}

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
          {/* v47: تسليم الوردية — الافتتاحي يأتي من معدود الوردية السابقة */}
          <HandoverPanel lastShift={lastClosedShift} value={openingCash}
            onChange={setOpeningCash} CUR={CUR} />

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
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--sub)", marginBottom: 8, display: "block" }}>
              عُدّ الصندوق بالفئات ({CUR}) — الآلة تجمع بدلاً عنك
            </label>
            {/* v47: العدّ بالفئات بدل رقم واحد. إدخال رقم مجموع ذهنياً يحوّل
                أي خطأ جمع إلى «عجز» يُلام عليه شخص؛ عدّ الأوراق يترك أثراً
                يُراجَع فئةً فئةً عند وجود فرق. */}
            <DenominationCounter
              value={countedCash}
              denominations={settings?.cashDenominations}
              CUR={CUR}
              onChange={(total, counts) => { setCountedCash(String(total)); setCountBreakdown(counts); }} />
            <div style={{ height: 12 }} />

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
              <>
              <div style={{
                background: dayGuard.near ? "rgba(230,81,0,.12)" : "rgba(21,101,192,.08)",
                border: `1.5px solid ${dayGuard.near ? "rgba(230,81,0,.4)" : "rgba(21,101,192,.25)"}`,
                borderRadius: 10, padding: "9px 13px", marginBottom: 10,
                fontSize: 11.5, lineHeight: 1.8, fontWeight: 700,
                color: dayGuard.near ? "#e65100" : "var(--sub)",
              }}>
                🗓 ستُحتسب هذه الوردية في جرد: <strong>{formatDayKey(dayGuard.key)}</strong>
                {shiftAge.tooLong && (
                  <>
                    <br />
                    ⏱ هذه الوردية مفتوحة منذ <strong>{shiftAge.hours} ساعة</strong> — تجاوزت الحدّ المعتاد
                    ({maxShiftHours} ساعة). تأكّد أنها لم تُترك مفتوحة سهواً.
                  </>
                )}
                {dayGuard.near && (
                  <>
                    <br />
                    ⚠ يتبقّى {dayGuard.minsLeft} دقيقة على نهاية اليوم المحاسبي.
                    إن أقفلتَ بعدها انتقل إيراد هذه الوردية إلى جرد الغد.
                  </>
                )}
              </div>
              <button onClick={() => { if (countedCash === "") { showToast("أدخل النقد المعدود أولاً", "error"); return; } setConfirmClose(true); }}
                style={{ width: "100%", background: "#e65100", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontWeight: 800, fontSize: 15, cursor: "pointer" }}>
                🔐 تقفيل الوردية
              </button>
              </>
            ) : (
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={closeShift} disabled={closing}
                  style={{ flex: 2, background: closing ? "#9e9e9e" : "#c62828", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontWeight: 800, fontSize: 14, cursor: closing ? "wait" : "pointer" }}>
                  {closing ? "⏳ جارٍ التأكيد من السحابة…" : "✓ تأكيد التقفيل النهائي"}
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
                  {/* v44: يُعرَض مَن أقفلها فعلاً — لا مَن فتحها */}
                  <div style={{ fontWeight: 800, fontSize: 14 }}>
                    {s.closedByName || s.userName || "—"}
                    {s.closedByName && s.userName && s.closedByName !== s.userName && (
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--sub)", marginRight: 6 }}>
                        (فتحها {s.userName})
                      </span>
                    )}
                  </div>
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
