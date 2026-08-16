// src/AdminTools.jsx — v47
// ══════════════════════════════════════════════════════════════════════
// أدوات الإدارة: لوحة صحة المزامنة · تقرير المطابقة الثلاثي
// ══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from "react";
import { outboxCount, outboxSnapshot, flushOutbox, SUPABASE_READY } from "./lib/supabase.js";
import {
  businessDayKey, formatDayKey, listBusinessDays, closedShiftsOfDay,
  sumShifts, ordersOfShifts, orderSale, orderTron,
} from "./lib/utils.js";

// ══════════════════════════════════════════════════════════════════════
// ١) لوحة صحة المزامنة
// ──────────────────────────────────────────────────────────────────────
// التطبيق يُطلق حدثَي nc-sync-error و nc-outbox منذ إصدارات، ولم يكن أحد
// يستمع لهما — فكل فشل مزامنة كان يمرّ في console وحده. هذه اللوحة تجعل
// الحالة مرئية: ماذا ينتظر الرفع، ومنذ متى، وما آخر خطأ حدث ولأي جدول.
//
// «العنصر السامّ»: صفٌّ يفشل مراراً (عمود مفقود، قيد مرفوض). يبقى في
// الطابور حتى 8 محاولات ثم يُسقَط. عرض عدد المحاولات يكشفه قبل سقوطه.
// ══════════════════════════════════════════════════════════════════════
export function SyncHealthPanel({ store, showToast }) {
  const [snap, setSnap] = useState([]);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const read = () => { try { setSnap(outboxSnapshot()); } catch { setSnap([]); } };
    read();
    const onOutbox = () => read();
    const onErr = (e) => setErrors(p => [{
      at: new Date().toISOString(),
      op: e?.detail?.op || "", table: e?.detail?.table || "", message: e?.detail?.message || "",
    }, ...p].slice(0, 30));
    window.addEventListener("nc-outbox", onOutbox);
    window.addEventListener("nc-sync-error", onErr);
    const iv = setInterval(() => { read(); setTick(t => t + 1); }, 5000);
    return () => {
      window.removeEventListener("nc-outbox", onOutbox);
      window.removeEventListener("nc-sync-error", onErr);
      clearInterval(iv);
    };
  }, []);

  const byTable = useMemo(() => {
    const m = new Map();
    snap.forEach(e => {
      const a = m.get(e.table) || { table: e.table, count: 0, oldest: null, maxTries: 0 };
      a.count++;
      a.maxTries = Math.max(a.maxTries, e.tries || 0);
      if (!a.oldest || e.ts < a.oldest) a.oldest = e.ts;
      m.set(e.table, a);
    });
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [snap]);

  const total = snap.length;
  const stuck = snap.filter(e => (e.tries || 0) >= 3).length;
  const online = typeof navigator === "undefined" || navigator.onLine !== false;

  const doFlush = async () => {
    setBusy(true);
    try { await flushOutbox(); showToast?.("↻ جرت محاولة رفع الطابور", "success"); }
    catch { showToast?.("تعذّرت المحاولة", "error"); }
    finally { setBusy(false); try { setSnap(outboxSnapshot()); } catch {} }
  };

  const age = (ts) => {
    if (!ts) return "—";
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return "الآن";
    if (m < 60) return `${m} د`;
    return `${Math.floor(m / 60)} س ${m % 60} د`;
  };

  const statusColor = !online ? "#c62828" : stuck > 0 ? "#e65100" : total > 0 ? "#f9a825" : "#2e7d32";
  const statusText = !online ? "📴 لا اتصال" : stuck > 0 ? "⚠ عناصر متعثّرة" : total > 0 ? "⏳ جارٍ الرفع" : "✅ كل شيء مرفوع";

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 900 }}>☁ صحة المزامنة</h3>
        <span style={{ fontSize: 12, fontWeight: 900, color: statusColor }}>{statusText}</span>
      </div>

      {!SUPABASE_READY && (
        <div style={{ background: "rgba(198,40,40,.1)", borderRadius: 8, padding: "9px 11px", fontSize: 12, fontWeight: 800, color: "#c62828", marginBottom: 10 }}>
          ⚠ السحابة غير مفعّلة — التطبيق يعمل محلياً ولا تتزامن البيانات بين الأجهزة.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}>
        {[
          ["في الطابور", total, total > 0 ? "#e65100" : "#2e7d32"],
          ["متعثّر (3+ محاولات)", stuck, stuck > 0 ? "#c62828" : "#2e7d32"],
          ["أخطاء هذه الجلسة", errors.length, errors.length > 0 ? "#e65100" : "#2e7d32"],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: "var(--card2)", borderRadius: 10, padding: "9px 6px", textAlign: "center" }}>
            <div style={{ fontSize: 19, fontWeight: 900, color: c }}>{v}</div>
            <div style={{ fontSize: 9.5, color: "var(--sub)", fontWeight: 700, lineHeight: 1.4 }}>{l}</div>
          </div>
        ))}
      </div>

      {total > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--sub)", marginBottom: 6 }}>ما ينتظر الرفع</div>
          {byTable.map(t => (
            <div key={t.table} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
              background: t.maxTries >= 3 ? "rgba(198,40,40,.09)" : "var(--card2)",
              borderRadius: 8, padding: "7px 10px", marginBottom: 5,
            }}>
              <span style={{ fontSize: 12, fontWeight: 800 }}>{t.table}</span>
              <span style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700 }}>
                {t.count} عنصر · أقدمها {age(t.oldest)}
                {t.maxTries >= 3 && <b style={{ color: "#c62828" }}> · {t.maxTries} محاولات</b>}
              </span>
            </div>
          ))}
        </div>
      )}

      <button onClick={doFlush} disabled={busy || !online}
        style={{
          width: "100%", background: busy || !online ? "#9e9e9e" : "#1565c0", color: "#fff", border: "none",
          borderRadius: 9, padding: "10px", fontWeight: 900, fontSize: 13,
          cursor: busy || !online ? "not-allowed" : "pointer", fontFamily: "inherit", marginBottom: errors.length ? 12 : 0,
        }}>
        {busy ? "⏳ جارٍ الرفع…" : "↻ حاول رفع الطابور الآن"}
      </button>

      {errors.length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--sub)", marginBottom: 6 }}>آخر أخطاء المزامنة</div>
          <div style={{ maxHeight: 160, overflowY: "auto" }}>
            {errors.map((e, i) => (
              <div key={i} style={{ background: "var(--card2)", borderRadius: 8, padding: "6px 9px", marginBottom: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#c62828" }}>
                  {e.op} · {e.table} — {new Date(e.at).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--sub)", lineHeight: 1.6, wordBreak: "break-word" }}>{e.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ٢) تقرير المطابقة الثلاثي
// ──────────────────────────────────────────────────────────────────────
// ثلاثة مصادر يجب أن تتطابق، وكل منها يُحسب بطريق مختلف:
//   (أ) لقطات الورديات المُقفلة  — ما وقّع عليه الكاشير عند الإقفال
//   (ب) الطلبات المدفوعة        — ما سُجّل فعلياً في جدول الطلبات
//   (ج) الفواتير                — ما طُبع وسُلّم للزبون
//
// تطابقها يعني أن الدفتر سليم. اختلافها يكشف نوع الخلل بدقّة:
//   أ ≠ ب  ⇒ طلب دُفع خارج وردية، أو وردية لم تلتقط طلباتها
//   ب ≠ ج  ⇒ دفعٌ بلا فاتورة (أو فاتورة لم تُرفع للسحابة)
// ══════════════════════════════════════════════════════════════════════
export const reconcileDay = (store, dayKey) => {
  const shifts = closedShiftsOfDay(store.shifts, dayKey, null);
  const agg = sumShifts(shifts);

  // (ب) الطلبات المنسوبة لورديات هذا اليوم
  const dayOrders = ordersOfShifts(store.orders, shifts);
  const paid = dayOrders.filter(o => o.status === "paid" && !o.isComplimentary);
  const ordersRevenue = paid.reduce((s, o) => s + orderSale(o), 0);
  const ordersCash = paid.filter(o => o.paymentType === "cash").reduce((s, o) => s + orderSale(o), 0);
  const ordersTron = paid.reduce((s, o) => s + orderTron(o), 0);

  // (ج) الفواتير المرتبطة بتلك الطلبات
  const orderIds = new Set(dayOrders.map(o => o.id));
  const receipts = (store.receipts || []).filter(r => r.orderId && orderIds.has(r.orderId));
  const receiptsTotal = receipts.reduce((s, r) => s + (+r.total || 0), 0);

  // طلبات مدفوعة بلا فاتورة — أخطر بند في التقرير
  const receiptOrderIds = new Set(receipts.map(r => r.orderId));
  const missingReceipts = paid.filter(o => !receiptOrderIds.has(o.id));

  const d1 = ordersRevenue - agg.totalSales;   // ب − أ
  const d2 = receiptsTotal - ordersRevenue;    // ج − ب

  return {
    dayKey,
    shiftsCount: agg.shiftsCount,
    sequence: shifts.map(s => s.shiftType === "morning" ? "صباحية" : s.shiftType === "evening" ? "مسائية" : s.shiftType === "night" ? "ليلية" : "؟").join(" ← "),
    shiftsRevenue: agg.totalSales,
    shiftsCash: agg.cashSales,
    shiftsTron: agg.tronSales,
    ordersRevenue, ordersCash, ordersTron,
    receiptsTotal, receiptsCount: receipts.length,
    paidCount: paid.length,
    missingReceipts,
    diffShiftsOrders: d1,
    diffOrdersReceipts: d2,
    cashVariance: agg.difference,
    balanced: Math.abs(d1) < 1 && Math.abs(d2) < 1,
  };
};

export function ReconcileTab({ store, settings, dm }) {
  const CUR = settings?.currency || "ل.س";
  const days = useMemo(() => listBusinessDays(store.shifts).slice(0, 30), [store.shifts]);
  const [dayKey, setDayKey] = useState(days[0] || businessDayKey());
  useEffect(() => { if (days.length && !days.includes(dayKey)) setDayKey(days[0]); }, [days.join(",")]);

  const r = useMemo(() => reconcileDay(store, dayKey), [store.shifts, store.orders, store.receipts, dayKey]);

  const row = (label, value, hint) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 11px", background: "var(--card2)", borderRadius: 9, marginBottom: 6 }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 800 }}>{label}</div>
        {hint && <div style={{ fontSize: 10, color: "var(--sub)", marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 900, whiteSpace: "nowrap" }}>{(+value || 0).toLocaleString()} {CUR}</div>
    </div>
  );

  const diffRow = (label, value, explain) => {
    const ok = Math.abs(+value || 0) < 1;
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px",
        background: ok ? "rgba(46,125,50,.1)" : "rgba(198,40,40,.12)",
        border: `1.5px solid ${ok ? "rgba(46,125,50,.3)" : "rgba(198,40,40,.45)"}`,
        borderRadius: 10, marginBottom: 7,
      }}>
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: ok ? "#2e7d32" : "#c62828" }}>
            {ok ? "✅" : "⛔"} {label}
          </div>
          {!ok && <div style={{ fontSize: 10.5, color: "#c62828", marginTop: 3, lineHeight: 1.6 }}>{explain}</div>}
        </div>
        <div style={{ fontSize: 15, fontWeight: 900, color: ok ? "#2e7d32" : "#c62828", whiteSpace: "nowrap" }}>
          {ok ? "مطابق" : `${(+value > 0 ? "+" : "")}${(+value).toLocaleString()}`}
        </div>
      </div>
    );
  };

  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>⚖ المطابقة الثلاثية</h2>
      <p style={{ fontSize: 11.5, color: "var(--sub)", lineHeight: 1.8, marginBottom: 14 }}>
        ثلاثة مصادر تُحسب بطرق مستقلّة — الورديات، الطلبات، الفواتير.
        تطابقها يعني أن دفتر اليوم سليم، واختلافها يكشف موضع الخلل بدقّة.
      </p>

      {!days.length ? (
        <div style={{ textAlign: "center", padding: 50, color: "var(--sub)" }}>
          <div style={{ fontSize: 44 }}>⚖</div>
          <div style={{ marginTop: 10 }}>لا توجد ورديات مقفلة بعد</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 7, overflowX: "auto", marginBottom: 14 }} className="scroll-hide">
            {days.map(d => (
              <button key={d} onClick={() => setDayKey(d)}
                style={{
                  flexShrink: 0, padding: "7px 13px", borderRadius: 18, border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontWeight: 800, fontSize: 11.5,
                  background: dayKey === d ? "#c62828" : "var(--card2)", color: dayKey === d ? "#fff" : "var(--sub)",
                }}>{d}</button>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, marginBottom: 3 }}>{formatDayKey(dayKey)}</div>
            <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 12 }}>
              {r.shiftsCount} وردية {r.sequence && `— ${r.sequence}`}
              {r.shiftsCount < 3 && <b style={{ color: "#e65100" }}> · ⚠ أقل من ثلاث ورديات</b>}
            </div>

            {row("أ) لقطات الورديات المُقفلة", r.shiftsRevenue, "ما وقّع عليه الكاشير عند الإقفال")}
            {row("ب) الطلبات المدفوعة", r.ordersRevenue, `${r.paidCount} طلب في جدول الطلبات`)}
            {row("ج) الفواتير الصادرة", r.receiptsTotal, `${r.receiptsCount} فاتورة مرتبطة بطلبات اليوم`)}
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>نتيجة المطابقة</h3>
            {diffRow("أ ↔ ب — الورديات مقابل الطلبات", r.diffShiftsOrders,
              "طلبٌ دُفع خارج أي وردية، أو وردية لم تلتقط كل طلباتها. راجع طلبات اليوم بلا shiftId.")}
            {diffRow("ب ↔ ج — الطلبات مقابل الفواتير", r.diffOrdersReceipts,
              "دفعٌ بلا فاتورة، أو فاتورة لم تصل السحابة. راجع القائمة أدناه.")}

            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px",
              background: Math.abs(r.cashVariance) < 1 ? "rgba(46,125,50,.1)" : "rgba(230,81,0,.12)",
              borderRadius: 10, marginTop: 4,
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 900 }}>💵 فرق الصندوق المُجمَّع لليوم</span>
              <span style={{ fontSize: 15, fontWeight: 900, color: Math.abs(r.cashVariance) < 1 ? "#2e7d32" : "#e65100" }}>
                {r.cashVariance > 0 ? "+" : ""}{r.cashVariance.toLocaleString()} {CUR}
              </span>
            </div>
          </div>

          {r.missingReceipts.length > 0 && (
            <div className="card" style={{ border: "1.5px solid rgba(198,40,40,.4)" }}>
              <h3 style={{ fontSize: 13.5, fontWeight: 900, color: "#c62828", marginBottom: 4 }}>
                ⛔ {r.missingReceipts.length} طلب مدفوع بلا فاتورة
              </h3>
              <p style={{ fontSize: 11, color: "var(--sub)", lineHeight: 1.7, marginBottom: 10 }}>
                قُبض المال ولم تُصدَر فاتورة مرتبطة. إمّا أن الفاتورة لم تُرفع للسحابة،
                أو أن الدفع تمّ بمسار يتخطّى إصدار الفاتورة.
              </p>
              {r.missingReceipts.slice(0, 25).map(o => (
                <div key={o.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, background: "var(--card2)", borderRadius: 8, padding: "7px 10px", marginBottom: 5 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800 }}>
                    #{o.orderNum} {o.table ? `· طاولة ${o.table}` : ""}
                    <span style={{ color: "var(--sub)", fontWeight: 600 }}>
                      {" "}— {new Date(o.paidAt || o.createdAt).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 900, color: "#c62828", whiteSpace: "nowrap" }}>
                    {(o.total || 0).toLocaleString()} {CUR}
                  </span>
                </div>
              ))}
              {r.missingReceipts.length > 25 && (
                <div style={{ fontSize: 11, color: "var(--sub)", textAlign: "center", marginTop: 6 }}>
                  …و{r.missingReceipts.length - 25} طلباً آخر
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
