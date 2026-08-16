// src/OpeningChecklist.jsx — v47
// ══════════════════════════════════════════════════════════════════════
// افتتاح اليوم: تنبيه الوردية غير المُقفلة + قائمة تحضير الافتتاح
// ══════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from "react";
import { businessDayKey, shiftBusinessDay } from "./lib/utils.js";

// ══════════════════════════════════════════════════════════════════════
// ١) تنبيه «لم تُقفل وردية الأمس»
// ──────────────────────────────────────────────────────────────────────
// وردية متروكة مفتوحة تُفسد كل شيء بصمت: طلبات اليوم الجديد تُنسب إليها،
// والجرد اليومي لا يُرسَل لأن اليوم لا يكتمل، والصندوق لا يُجرد. وكان لا
// شيء يُنبّه إلى ذلك سوى تدقيق يدوي في شاشة الورديات.
//
// يظهر عند أول دخول صباحي إذا وُجدت وردية مفتوحة تنتمي ليوم محاسبي مضى.
// ══════════════════════════════════════════════════════════════════════
export const staleOpenShifts = (shifts, ref = new Date()) => {
  const today = businessDayKey(ref);
  return (shifts || []).filter(s => {
    if (s.status !== "open") return false;
    const d = shiftBusinessDay(s);
    return d && d < today;
  });
};

export function StaleShiftAlert({ store, user, onGoToShifts }) {
  const stale = useMemo(() => staleOpenShifts(store.shifts), [store.shifts]);
  const [dismissed, setDismissed] = useState(false);
  if (!stale.length || dismissed) return null;
  if (!["admin", "cashier"].includes(user?.role)) return null;

  return (
    <div style={{
      background: "rgba(198,40,40,.12)", border: "1.5px solid rgba(198,40,40,.45)",
      borderRadius: 11, padding: "12px 14px", marginBottom: 14,
    }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: "#c62828", marginBottom: 6 }}>
        ⛔ {stale.length === 1 ? "وردية لم تُقفل" : `${stale.length} ورديات لم تُقفل`}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--sub)", lineHeight: 1.9, marginBottom: 10 }}>
        ما دامت مفتوحة فطلبات اليوم الجديد تُنسب إليها، ولا يُرسَل جرد يومها،
        ولا يُجرد صندوقها. أقفلها قبل بدء العمل.
      </div>
      {stale.map(s => (
        <div key={s.id} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
          background: "var(--card2)", borderRadius: 8, padding: "7px 10px", marginBottom: 5, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 11.5, fontWeight: 800 }}>
            {(s.branch || "main") === "outdoor" ? "🌿 الحديقة" : "☕ الكافيه"}
            {" — "}{s.userName || "—"}
            <span style={{ color: "var(--sub)", fontWeight: 600 }}>
              {" "}· يوم {shiftBusinessDay(s)} · منذ {Math.floor((Date.now() - new Date(s.openedAt).getTime()) / 3600000)} ساعة
            </span>
          </span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={onGoToShifts}
          style={{ flex: 2, background: "#c62828", color: "#fff", border: "none", borderRadius: 8, padding: "9px", fontWeight: 900, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
          اذهب لإقفالها
        </button>
        <button onClick={() => setDismissed(true)}
          style={{ flex: 1, background: "transparent", color: "var(--sub)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          لاحقاً
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ٢) قائمة تحضير الافتتاح
// ──────────────────────────────────────────────────────────────────────
// عامل الصباح يبدأ يومه أعمى: لا يعرف ما نفد ليلاً حتى يطلبه زبون فيجده
// مفقوداً. هذه القائمة تعرض عند فتح الوردية الصباحية:
//   • ما نفد فعلاً (رصيد صفر)         ← يحتاج تعبئة قبل أول زبون
//   • ما اقترب من النفاد (≤ الحد الأدنى)
//   • مواد إضافية منخفضة
// وجرد سريع: زرّ واحد بجانب كل صنف ناقص يضيف كمية بثلاث نقرات.
// ══════════════════════════════════════════════════════════════════════
export function OpeningChecklist({ store, user, showToast, settings }) {
  const [qty, setQty] = useState({});
  const [busy, setBusy] = useState({});
  const [done, setDone] = useState({});

  const openShift = (store.shifts || []).find(s => s.status === "open" && (s.branch || "main") === "main");

  const outOfStock = useMemo(
    () => (store.menu || []).filter(m => m.active !== false && !m.noStock && m.trackStock !== false && (+m.stock || 0) < 1),
    [store.menu]
  );
  const lowStock = useMemo(
    () => (store.menu || []).filter(m => m.active !== false && !m.noStock && m.trackStock !== false
      && (+m.stock || 0) >= 1 && (+m.stock || 0) <= (+m.minStock || 0)),
    [store.menu]
  );
  const lowSupplies = useMemo(
    () => (store.supplies || []).filter(s => s.active !== false && (+s.qty || 0) <= (+s.minStock || 0)),
    [store.supplies]
  );

  const readQty = (id) => { const n = Math.floor(+qty[id]); return (isNaN(n) || n < 1) ? 10 : Math.min(n, 9999); };

  const restock = async (item, isSupply = false) => {
    const q = readQty(item.id);
    setBusy(b => ({ ...b, [item.id]: true }));
    const meta = {
      reason: "restock", note: "جرد افتتاح", userId: user.id, userName: user.name,
      userRole: user.role, shiftId: openShift?.id || null, branch: "main",
    };
    const r = isSupply ? await store.adjustSupply(item.id, q, meta) : await store.adjustStock(item.id, q, meta);
    setBusy(b => { const n = { ...b }; delete n[item.id]; return n; });
    if (r && r.ok === false && r.reason !== "noop") { showToast?.("⚠ تعذّر التعديل — أعد المحاولة", "error"); return; }
    setQty(m => ({ ...m, [item.id]: "" }));
    setDone(d => ({ ...d, [item.id]: true }));
    showToast?.(`➕ أُضيف ${q} إلى ${item.name}`, "success");
  };

  const total = outOfStock.length + lowStock.length + lowSupplies.length;

  const box = {
    width: 52, height: 30, textAlign: "center", fontWeight: 800, fontSize: 13,
    borderRadius: 7, border: "1.5px solid var(--border)", background: "var(--card)",
    color: "inherit", fontFamily: "inherit",
  };

  const line = (item, isSupply, tone) => (
    <div key={item.id} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 7,
      background: done[item.id] ? "rgba(46,125,50,.12)" : "var(--card2)",
      borderRadius: 9, padding: "7px 10px", marginBottom: 5, flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 12, fontWeight: 800, flex: 1, minWidth: 110 }}>
        {done[item.id] ? "✅ " : ""}{item.emoji || (isSupply ? "📦" : "☕")} {item.name}
        <span style={{ color: tone, fontWeight: 900 }}>
          {" "}· {isSupply ? (+item.qty || 0) : (+item.stock || 0)}{item.unit ? ` ${item.unit}` : ""}
        </span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <input value={qty[item.id] ?? ""} onChange={e => setQty(m => ({ ...m, [item.id]: e.target.value.replace(/[^0-9]/g, "") }))}
          inputMode="numeric" placeholder="10" style={box} />
        <button onClick={() => restock(item, isSupply)} disabled={!!busy[item.id]}
          style={{
            background: busy[item.id] ? "#9e9e9e" : "#2e7d32", color: "#fff", border: "none", borderRadius: 7,
            padding: "7px 12px", fontWeight: 900, fontSize: 11.5, cursor: busy[item.id] ? "wait" : "pointer", fontFamily: "inherit",
          }}>
          {busy[item.id] ? "…" : "➕ أضف"}
        </button>
      </span>
    </div>
  );

  return (
    <div className="card fade-in" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, fontWeight: 900 }}>🌅 تحضير الافتتاح</h3>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: total ? "#e65100" : "#2e7d32" }}>
          {total ? `${total} بند يحتاج انتباهاً` : "✅ كل شيء جاهز"}
        </span>
      </div>
      <p style={{ fontSize: 11, color: "var(--sub)", lineHeight: 1.7, marginBottom: 12 }}>
        ما نفد أثناء الوردية الليلية وما اقترب من النفاد — عبّئه قبل أول زبون.
        اكتب الكمية واضغط «أضف» (الافتراضي 10).
      </p>

      {!total ? (
        <div style={{ textAlign: "center", padding: 24, color: "var(--sub)" }}>
          <div style={{ fontSize: 36 }}>✨</div>
          <div style={{ marginTop: 8, fontSize: 12.5 }}>لا يوجد نقص — ابدأ يومك</div>
        </div>
      ) : (
        <>
          {outOfStock.length > 0 && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 900, color: "#c62828", marginBottom: 6 }}>
                ⛔ نفد تماماً ({outOfStock.length}) — لا يمكن بيعه الآن
              </div>
              {outOfStock.map(m => line(m, false, "#c62828"))}
            </>
          )}
          {lowStock.length > 0 && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 900, color: "#e65100", margin: "10px 0 6px" }}>
                ⚠ قارب على النفاد ({lowStock.length})
              </div>
              {lowStock.map(m => line(m, false, "#e65100"))}
            </>
          )}
          {lowSupplies.length > 0 && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 900, color: "#e65100", margin: "10px 0 6px" }}>
                📦 مواد إضافية منخفضة ({lowSupplies.length})
              </div>
              {lowSupplies.map(s => line(s, true, "#e65100"))}
            </>
          )}
        </>
      )}
    </div>
  );
}
