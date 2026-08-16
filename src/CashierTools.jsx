// src/CashierTools.jsx — v47
// ══════════════════════════════════════════════════════════════════════
// أدوات الكاشير: شريط الدرج الحيّ · عدّ الصندوق بالفئات · تسليم الوردية
//                · شريط الطلب السريع
// كلها مكوّنات مستقلّة بلا حالة عامة، تُركَّب في الشاشات القائمة.
// ══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from "react";
import { calcShiftSummary, shiftExpectedCash } from "./lib/utils.js";
import { outboxCount } from "./lib/supabase.js";

// ══════════════════════════════════════════════════════════════════════
// ١) شريط درج الصندوق الحيّ
// ──────────────────────────────────────────────────────────────────────
// المشكلة التي يحلّها: الكاشير لا يعرف وضعه إلا لحظة الإقفال، فيكتشف
// العجز بعد انتهاء الوردية حين يستحيل تتبّع مصدره. هذا الشريط يجعل
// الرقم المتوقّع حاضراً طوال الوقت، فيُكتشف الخلل ساعة وقوعه.
//
// ويعرض أيضاً عدد العناصر العالقة في طابور المزامنة — مؤشّر حاسم:
// رقم > 0 يعني أن جزءاً من عمل الوردية لم يصل السحابة بعد، ولا يجوز
// الإقفال ولا مغادرة الجهاز قبل أن يعود إلى صفر.
// ══════════════════════════════════════════════════════════════════════
export function CashDrawerBar({ store, user, settings, branch = "main", onOpenShifts }) {
  const CUR = settings?.currency || "ل.س";
  const [tick, setTick] = useState(0);
  const [pending, setPending] = useState(0);

  // نبضة كل 30 ثانية لتحديث المدّة والأرقام
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(iv);
  }, []);

  // الطابور يتغيّر خارج React — نستمع لحدثه ونستطلعه دورياً
  useEffect(() => {
    const read = () => { try { setPending(outboxCount()); } catch {} };
    read();
    const onOutbox = (e) => setPending(e?.detail?.pending ?? outboxCount());
    window.addEventListener("nc-outbox", onOutbox);
    const iv = setInterval(read, 5000);
    return () => { window.removeEventListener("nc-outbox", onOutbox); clearInterval(iv); };
  }, []);

  const openShift = useMemo(
    () => (store.shifts || []).find(s => s.status === "open" && (s.branch || "main") === branch),
    [store.shifts, branch]
  );

  const summary = useMemo(() => {
    if (!openShift) return null;
    return calcShiftSummary(store.orders, store.expenses, openShift.id, openShift.openedAt, branch);
  }, [openShift, store.orders, store.expenses, branch, tick]);

  const expected = openShift && summary ? shiftExpectedCash(openShift.openingCash, summary) : 0;
  const hours = openShift?.openedAt
    ? (Date.now() - new Date(openShift.openedAt).getTime()) / 3600000 : 0;
  const maxHours = settings?.shiftMaxHours || 12;
  const tooLong = hours > maxHours;

  const cell = { display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 62 };
  const lbl = { fontSize: 9, fontWeight: 700, opacity: .75, whiteSpace: "nowrap" };
  const val = { fontSize: 12.5, fontWeight: 900, whiteSpace: "nowrap" };

  if (!openShift) {
    return (
      <div onClick={onOpenShifts} style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        background: "rgba(198,40,40,.12)", borderBottom: "1.5px solid rgba(198,40,40,.35)",
        padding: "7px 12px", cursor: onOpenShifts ? "pointer" : "default",
      }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: "#c62828" }}>
          ⚠ لا توجد وردية مفتوحة — افتح وردية قبل بدء العمل
        </span>
        {pending > 0 && (
          <span style={{ fontSize: 10.5, fontWeight: 800, color: "#e65100" }}>· ⏳ {pending} معلّق</span>
        )}
      </div>
    );
  }

  return (
    <div onClick={onOpenShifts} style={{
      display: "flex", alignItems: "center", justifyContent: "space-around", gap: 6,
      background: tooLong ? "rgba(230,81,0,.14)" : "var(--card2)",
      borderBottom: `1.5px solid ${tooLong ? "rgba(230,81,0,.4)" : "var(--border)"}`,
      padding: "6px 10px", overflowX: "auto", cursor: onOpenShifts ? "pointer" : "default",
    }} className="scroll-hide">

      <div style={cell}>
        <span style={lbl}>💰 المتوقّع الآن</span>
        <span style={{ ...val, color: "#2e7d32" }}>{expected.toLocaleString()} {CUR}</span>
      </div>

      <div style={cell}>
        <span style={lbl}>🧾 فواتير</span>
        <span style={val}>{summary?.ordersCount || 0}</span>
      </div>

      <div style={cell}>
        <span style={lbl}>📤 مصاريف</span>
        <span style={{ ...val, color: "#c62828" }}>{(summary?.expensesTotal || 0).toLocaleString()}</span>
      </div>

      <div style={cell}>
        <span style={lbl}>⏱ مفتوحة منذ</span>
        <span style={{ ...val, color: tooLong ? "#e65100" : "inherit" }}>
          {Math.floor(hours)}س {Math.floor((hours % 1) * 60)}د
        </span>
      </div>

      <div style={cell}>
        <span style={lbl}>☁ الطابور</span>
        <span style={{ ...val, color: pending > 0 ? "#e65100" : "#2e7d32" }}>
          {pending > 0 ? `⏳ ${pending}` : "✓ 0"}
        </span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ٢) عدّ الصندوق بالفئات
// ──────────────────────────────────────────────────────────────────────
// إدخال رقم واحد يعني أن الكاشير جمع الأوراق ذهنياً؛ وأي خطأ جمع يظهر
// لاحقاً كـ«عجز» يُلام عليه شخص. العدّ بالفئات يحوّل المهمة إلى عدّ أوراق
// (الآلة تجمع)، ويترك أثراً: عند وجود فرق يمكن مراجعة أي فئة أُخطئ عدّها.
//
// الفئات قابلة للتعديل من الإعدادات (settings.cashDenominations) لأن
// الفئات المتداولة في سوريا تتغيّر.
// ══════════════════════════════════════════════════════════════════════
export const DEFAULT_DENOMINATIONS = [5000, 2000, 1000, 500, 200, 100, 50];

export function DenominationCounter({ value, onChange, denominations, CUR = "ل.س", compact = false }) {
  const denoms = (denominations && denominations.length ? denominations : DEFAULT_DENOMINATIONS)
    .map(Number).filter(n => n > 0).sort((a, b) => b - a);
  const [counts, setCounts] = useState({});
  const [manual, setManual] = useState(false);

  const total = useMemo(
    () => denoms.reduce((s, d) => s + d * (Math.max(0, Math.floor(+counts[d] || 0))), 0),
    [counts, denoms]
  );

  // نُبلّغ الأب بالمجموع كلما تغيّر — ما دام في وضع العدّ بالفئات
  useEffect(() => { if (!manual) onChange?.(total, counts); }, [total, manual]);

  const setC = (d, v) => setCounts(p => ({ ...p, [d]: v.replace(/[^0-9]/g, "") }));
  const clear = () => setCounts({});

  const box = {
    width: 56, height: 34, textAlign: "center", fontWeight: 800, fontSize: 14,
    borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card)",
    color: "inherit", fontFamily: "inherit",
  };

  if (manual) {
    return (
      <div>
        <input className="input" type="number" inputMode="numeric" value={value ?? ""}
          onChange={e => onChange?.(Math.max(0, +e.target.value || 0), null)}
          placeholder="المبلغ المعدود" style={{ fontSize: 16, fontWeight: 800, textAlign: "center" }} />
        <button onClick={() => { setManual(false); }}
          style={{ marginTop: 8, background: "transparent", border: "none", color: "#1565c0", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          ↩ العودة للعدّ بالفئات
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 1fr", gap: 6, marginBottom: 8 }}>
        {denoms.map(d => {
          const c = Math.max(0, Math.floor(+counts[d] || 0));
          return (
            <div key={d} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
              background: c > 0 ? "rgba(46,125,50,.09)" : "var(--card2)",
              borderRadius: 9, padding: "5px 8px",
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 900, minWidth: 44 }}>{d.toLocaleString()}</span>
              <span style={{ fontSize: 12, color: "var(--sub)" }}>×</span>
              <input value={counts[d] ?? ""} onChange={e => setC(d, e.target.value)}
                inputMode="numeric" placeholder="0" style={box} />
              <span style={{ fontSize: 11.5, fontWeight: 800, color: c > 0 ? "#2e7d32" : "var(--sub)", minWidth: 62, textAlign: "left" }}>
                {(d * c).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(21,101,192,.1)", borderRadius: 10, padding: "9px 12px",
      }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--sub)" }}>مجموع المعدود</span>
        <span style={{ fontSize: 17, fontWeight: 900, color: "#1565c0" }}>{total.toLocaleString()} {CUR}</span>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={clear}
          style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontWeight: 800, fontSize: 11.5, color: "var(--sub)", cursor: "pointer", fontFamily: "inherit" }}>
          🗑 تصفير العدّ
        </button>
        <button onClick={() => setManual(true)}
          style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontWeight: 800, fontSize: 11.5, color: "var(--sub)", cursor: "pointer", fontFamily: "inherit" }}>
          ✏ إدخال رقم واحد
        </button>
      </div>
    </div>
  );
}

// نصّ ملخّص العدّ — يُحفَظ في ملاحظات الوردية فيبقى أثراً دائماً
export const denominationNote = (counts) => {
  if (!counts) return "";
  const parts = Object.entries(counts)
    .map(([d, c]) => [Number(d), Math.max(0, Math.floor(+c || 0))])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([d, c]) => `${d.toLocaleString()}×${c}`);
  return parts.length ? `عدّ الفئات: ${parts.join(" · ")}` : "";
};

// ══════════════════════════════════════════════════════════════════════
// ٣) تسليم الوردية
// ──────────────────────────────────────────────────────────────────────
// أصل الجدل: الكاشير الخارج يقول «تركت 50 ألفاً» والداخل يقول «وجدت 45».
// لا سجل يحسم. الحل: الافتتاحي للوردية الجديدة ليس رقماً يُكتب من الذاكرة،
// بل **هو نفسه** المعدود المُقفل للوردية السابقة، مع توقيع الداخل عليه.
// إن اختلف الداخل، يُدخل رقمه ويُسجَّل الفرق باسميهما معاً — فينتقل الجدل
// من الكلام إلى سجل موثّق لحظة حدوثه.
// ══════════════════════════════════════════════════════════════════════
export function HandoverPanel({ lastShift, value, onChange, onAccept, CUR = "ل.س" }) {
  if (!lastShift || lastShift.countedCash == null) return null;
  const handover = +lastShift.countedCash || 0;
  const entered = +value || 0;
  const diff = entered - handover;
  const accepted = Math.abs(diff) < 1 && String(value ?? "") !== "";

  return (
    <div style={{
      background: "rgba(21,101,192,.08)", border: "1.5px solid rgba(21,101,192,.3)",
      borderRadius: 10, padding: "11px 13px", marginBottom: 12,
    }}>
      <div style={{ fontSize: 12.5, fontWeight: 900, color: "#1565c0", marginBottom: 6 }}>
        🤝 تسليم من الوردية السابقة
      </div>
      <div style={{ fontSize: 11.5, color: "var(--sub)", lineHeight: 1.9, marginBottom: 9 }}>
        أقفل <b style={{ color: "var(--text)" }}>{lastShift.closedByName || lastShift.userName || "—"}</b> على
        معدود <b style={{ color: "#1565c0" }}>{handover.toLocaleString()} {CUR}</b>
        {lastShift.closedAt && <> — {new Date(lastShift.closedAt).toLocaleString("ar-SY", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</>}
      </div>

      <button onClick={() => { onChange?.(String(handover)); onAccept?.(handover); }}
        style={{
          width: "100%", background: accepted ? "#2e7d32" : "#1565c0", color: "#fff", border: "none",
          borderRadius: 9, padding: "10px 12px", fontWeight: 900, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
        }}>
        {accepted ? `✓ وقّعتُ على استلام ${handover.toLocaleString()} ${CUR}` : `أستلم ${handover.toLocaleString()} ${CUR} كافتتاحي`}
      </button>

      {String(value ?? "") !== "" && Math.abs(diff) >= 1 && (
        <div style={{
          marginTop: 8, background: "rgba(230,81,0,.12)", borderRadius: 8, padding: "8px 10px",
          fontSize: 11.5, fontWeight: 800, color: "#e65100", lineHeight: 1.8,
        }}>
          ⚠ رقمك يخالف التسليم بـ <b>{Math.abs(diff).toLocaleString()} {CUR}</b> ({diff > 0 ? "زيادة" : "نقص"}).
          <br />سيُسجَّل الفرق باسمك واسم مَن سلّمك في ملاحظات الوردية.
        </div>
      )}
    </div>
  );
}

// نصّ يُحفَظ في ملاحظات الوردية الجديدة عند اختلاف الافتتاحي عن التسليم
export const handoverNote = (lastShift, opening, userName) => {
  if (!lastShift || lastShift.countedCash == null) return "";
  const h = +lastShift.countedCash || 0;
  const o = +opening || 0;
  const from = lastShift.closedByName || lastShift.userName || "—";
  if (Math.abs(o - h) < 1) return `تسليم مطابق من ${from}: ${h.toLocaleString()}`;
  return `⚠ تسليم مختلف — ${from} أقفل على ${h.toLocaleString()} واستلم ${userName || "—"} ${o.toLocaleString()} (فرق ${(o - h).toLocaleString()})`;
};

// ══════════════════════════════════════════════════════════════════════
// ٤) شريط الطلب السريع
// ──────────────────────────────────────────────────────────────────────
// «الأكثر مبيعاً» عموماً رقم بلا فائدة عند الكاشير: الشاي يتصدّر صباحاً
// والعصائر ليلاً. هذا الشريط يحسب الأكثر طلباً **في هذه الساعة تحديداً**
// من تاريخ آخر 21 يوماً (نافذة ±1 ساعة)، فيقترح ما يُطلب فعلاً الآن.
// عند غياب تاريخ كافٍ يرتدّ للأكثر مبيعاً إجمالاً حتى لا يظهر فارغاً.
// ══════════════════════════════════════════════════════════════════════
export const topItemsThisHour = (orders, menu, { count = 6, days = 21, branch = "main" } = {}) => {
  const now = new Date();
  const hour = now.getUTCHours();
  const since = now.getTime() - days * 86400000;
  const tally = new Map();

  (orders || []).forEach(o => {
    if ((o.branch || "main") !== branch) return;
    if (!["paid", "debt", "complimentary"].includes(o.status)) return;
    const ts = new Date(o.paidAt || o.createdAt).getTime();
    if (!(ts >= since)) return;
    const h = new Date(ts).getUTCHours();
    // نافذة ±1 ساعة (دائرية عبر منتصف الليل)
    const d = Math.min(Math.abs(h - hour), 24 - Math.abs(h - hour));
    if (d > 1) return;
    (o.items || []).forEach(it => {
      if (!it.itemId) return;
      tally.set(it.itemId, (tally.get(it.itemId) || 0) + (+it.qty || 0));
    });
  });

  const avail = (m) => m && m.active !== false && !(m.trackStock !== false && !m.noStock && (+m.stock || 0) < 1);

  let ranked = Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, qty]) => ({ item: (menu || []).find(m => m.id === id), qty }))
    .filter(x => avail(x.item));

  // ارتداد: لا تاريخ كافٍ في هذه الساعة ⇒ الأكثر مبيعاً إجمالاً
  if (ranked.length < count) {
    const seen = new Set(ranked.map(x => x.item.id));
    const fallback = (menu || [])
      .filter(m => avail(m) && !seen.has(m.id) && !m.isSession && !m.isCustom)
      .sort((a, b) => (+b.totalSold || 0) - (+a.totalSold || 0))
      .map(m => ({ item: m, qty: 0 }));
    ranked = [...ranked, ...fallback];
  }

  return ranked.slice(0, count);
};

export function QuickOrderBar({ orders, menu, branch = "main", onPick, CUR = "ل.س" }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const iv = setInterval(() => setTick(t => t + 1), 600000); return () => clearInterval(iv); }, []);
  const top = useMemo(() => topItemsThisHour(orders, menu, { branch }), [orders, menu, branch, tick]);
  if (!top.length) return null;

  const hourLabel = new Date().toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--sub)", marginBottom: 6 }}>
        ⚡ الأكثر طلباً في هذه الساعة ({hourLabel})
      </div>
      <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 4 }} className="scroll-hide">
        {top.map(({ item, qty }) => (
          <button key={item.id} onClick={() => onPick?.(item)}
            style={{
              flexShrink: 0, minWidth: 96, background: "var(--card2)", border: "1.5px solid var(--border)",
              borderRadius: 11, padding: "8px 10px", cursor: "pointer", fontFamily: "inherit",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            }}>
            <span style={{ fontSize: 19 }}>{item.emoji || "☕"}</span>
            <span style={{ fontSize: 11, fontWeight: 800, textAlign: "center", lineHeight: 1.3, color: "var(--text)" }}>
              {item.name}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 900, color: "#2e7d32" }}>
              {(branch === "outdoor" ? (item.outdoorPrice ?? item.price) : item.price)?.toLocaleString()} {CUR}
            </span>
            {qty > 0 && <span style={{ fontSize: 9, color: "var(--sub)", fontWeight: 700 }}>طُلب {qty}×</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
