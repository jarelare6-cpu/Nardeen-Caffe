// src/ShiftReplay.jsx — v45
// ══════════════════════════════════════════════════════════════════════
// «إعادة تشغيل الوردية» + «كاشف الفاقد»
//
// قاعدة معمارية (تعلّمناها من عطل v44): لا مكوّن يُعرَّف داخل مكوّن.
// كل ما هنا في نطاق الوحدة، والحسابات الثقيلة داخل useMemo.
//
// نبرة الواجهة مقصودة: «يستحقّ النظر» لا «مخالفة». الشاشة تعرض وقائع
// وتترك الحكم للإنسان — مؤشّر يتّهم بلا دليل يُهمَل بعد أول خطأ.
// ══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo } from "react";
import { fetchActivityRange, SUPABASE_READY } from "./lib/supabase.js";
import { buildTimeline, buildSummary, detectSignals, buildWasteReport, rowTime, clockSkewMs } from "./lib/replay.js";

const ACTION_STYLE = {
  "دفع طلب":        { icon: "💰", color: "#2e7d32" },
  "دفع جزئي":       { icon: "💰", color: "#e65100" },
  "إنشاء طلب":      { icon: "🧾", color: "#1565c0" },
  "إلغاء طلب":      { icon: "🚫", color: "#c62828" },
  "تعديل طلب":      { icon: "✏",  color: "#e65100" },
  "تغيير سعر صنف":  { icon: "🏷", color: "#c62828" },
  "حذف صنف":        { icon: "🗑", color: "#c62828" },
  "طباعة فاتورة":   { icon: "🖨", color: "#6a1b9a" },
  "تسجيل دخول":     { icon: "🔑", color: "#6a1b9a" },
  "تسجيل خروج":     { icon: "🚪", color: "#6a1b9a" },
  "تثبيت خصم":      { icon: "🏷", color: "#e65100" },
  "ضيافة":          { icon: "🎁", color: "#f9a825" },
  "مشروب عامل":     { icon: "🥤", color: "#f9a825" },
  "تصفير بيانات":   { icon: "⚠", color: "#c62828" },
};

const fmtTime = (t) => new Date(t).toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });
const fmtFull = (t) => new Date(t).toLocaleString("ar-SY", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const n = (v) => Number(v || 0).toLocaleString();

// ── بطاقة رقم ─────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: "var(--card2)", borderRadius: 12, padding: "12px 14px", flex: 1, minWidth: 108 }}>
      <div style={{ fontSize: 11, color: "var(--sub)", fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 900, color: color || "var(--text)" }}>{value}</div>
      {sub ? <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

// ── إشارة ─────────────────────────────────────────────────────────────
function SignalRow({ s, cur }) {
  const high = s.level === "high";
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10,
      background: high ? "rgba(198,40,40,.10)" : "rgba(249,168,37,.09)",
      border: `1px solid ${high ? "rgba(198,40,40,.35)" : "rgba(249,168,37,.3)"}`, marginBottom: 8,
    }}>
      <span style={{ fontSize: 17 }}>{high ? "🔴" : "🟡"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: high ? "#c62828" : "#e65100" }}>
          {s.title} — طلب #{s.orderNum}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--sub)", marginTop: 3, lineHeight: 1.6 }}>{s.why}</div>
        <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 3 }}>
          {fmtTime(s.at)} • {n(s.amount)} {cur}{s.reason ? ` • السبب المُدخَل: ${s.reason}` : ""}
        </div>
      </div>
    </div>
  );
}

// ── سطر في الخط الزمني ────────────────────────────────────────────────
function EventRow({ r }) {
  const st = ACTION_STYLE[r.action] || { icon: "•", color: "var(--sub)" };
  const skew = clockSkewMs(r);
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 4px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, color: "var(--sub)", minWidth: 42, fontWeight: 700, paddingTop: 2 }}>{fmtTime(rowTime(r))}</div>
      <span style={{ fontSize: 15, lineHeight: 1.3 }}>{st.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800 }}>
          <span style={{ color: st.color }}>{r.action}</span>
          {r.order_num ? <span style={{ opacity: .75 }}> #{r.order_num}</span> : null}
          {r.amount ? <span style={{ marginInlineStart: 6 }}>{n(r.amount)}</span> : null}
          {skew > 120000 ? (
            <span title="ساعة الجهاز تختلف عن ساعة الخادم" style={{ marginInlineStart: 6, fontSize: 10, color: "#e65100" }}>⏱ ساعة الجهاز منحرفة</span>
          ) : null}
        </div>
        <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>
          {r.user_name || "—"}{r.details ? ` — ${r.details}` : ""}
        </div>
      </div>
    </div>
  );
}

// ── سطر في كاشف الفاقد ────────────────────────────────────────────────
function WasteRow({ w, cur }) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", marginBottom: 6, borderRadius: 10,
      background: w.flagged ? "rgba(198,40,40,.08)" : "var(--card2)",
      border: w.flagged ? "1px solid rgba(198,40,40,.3)" : "1px solid transparent",
    }}>
      <span style={{ fontSize: 16 }}>{w.flagged ? "🔴" : "•"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{w.itemName}</div>
        <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 2 }}>{w.note}</div>
      </div>
      <div style={{ textAlign: "left", whiteSpace: "nowrap" }}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: w.flagged ? "#c62828" : "var(--sub)" }}>
          نقص {w.shortTimes} مرة
        </div>
        <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 2 }}>
          صافي {n(w.net)}{w.lossValue > 0 ? ` • ${n(Math.round(w.lossValue))} ${cur}` : ""}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
export default function ShiftReplay({ store, settings }) {
  const CUR = settings?.currency || "ل.س";
  const [view, setView] = useState("replay");           // replay | waste
  const [shiftId, setShiftId] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [page, setPage] = useState(1);
  const PER = 200;

  // أحدث 30 وردية — الترتيب من الأحدث للأقدم
  const shifts = useMemo(() => (store.shifts || [])
    .slice().sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt)).slice(0, 30), [store.shifts]);

  const shift = useMemo(() => shifts.find(s => s.id === shiftId) || shifts[0] || null, [shifts, shiftId]);

  // جلب حركات النافذة فقط (لا «آخر 200»)
  useEffect(() => {
    if (!shift || view !== "replay") return;
    let alive = true;
    setLoading(true); setErr(null); setPage(1);
    const from = new Date(shift.openedAt).toISOString();
    const to = new Date(shift.closedAt || Date.now()).toISOString();
    fetchActivityRange(from, to, shift.branch || "main", 1500)
      .then(d => { if (alive) { setRows(d); setLoading(false); } })
      .catch(e => { if (alive) { setErr(e?.message || "تعذّر الجلب"); setLoading(false); } });
    return () => { alive = false; };
  }, [shift?.id, shift?.closedAt, view]);

  const timeline = useMemo(() => buildTimeline(rows, shift), [rows, shift]);
  const summary  = useMemo(() => buildSummary(store.orders, shift), [store.orders, shift]);
  const signals  = useMemo(() => detectSignals(store.orders, shift), [store.orders, shift]);
  const waste    = useMemo(() => buildWasteReport(store.stockMoves, { days: 90, menu: store.menu }), [store.stockMoves, store.menu]);

  const shown = timeline.slice(0, page * PER);
  const highCount = signals.filter(s => s.level === "high").length;

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900 }}>🔁 إعادة تشغيل الوردية</h2>
        <div style={{ display: "flex", gap: 6 }}>
          {[["replay", "🔁 الوردية"], ["waste", "📉 الفاقد"]].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: "7px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontFamily: "inherit",
                background: view === v ? "#c62828" : "var(--card2)", color: view === v ? "#fff" : "var(--sub)",
                fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>{l}</button>
          ))}
        </div>
      </div>

      {view === "replay" && (
        <>
          {!shifts.length ? (
            <div className="card" style={{ textAlign: "center", padding: 40, color: "var(--sub)" }}>
              <div style={{ fontSize: 40 }}>🕐</div>
              <div style={{ marginTop: 10 }}>لا توجد ورديات مسجّلة بعد.</div>
            </div>
          ) : (
            <>
              <select className="input" value={shift?.id || ""} onChange={e => setShiftId(e.target.value)}
                style={{ marginBottom: 14, fontWeight: 700 }}>
                {shifts.map(s => (
                  <option key={s.id} value={s.id}>
                    {fmtFull(s.openedAt)} — {s.userName || "—"} {s.status === "open" ? "• مفتوحة الآن" : ""}
                  </option>
                ))}
              </select>

              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <StatCard label="الإلغاءات" value={summary.cancels}
                  sub={summary.cancelValue ? `${n(summary.cancelValue)} ${CUR}` : "—"}
                  color={summary.cancels ? "#c62828" : undefined} />
                <StatCard label="الخصومات" value={n(summary.discountValue)} sub={CUR}
                  color={summary.discountValue ? "#e65100" : undefined} />
                <StatCard label="فرق الصندوق" value={n(summary.difference)} sub={CUR}
                  color={summary.difference < 0 ? "#c62828" : summary.difference > 0 ? "#2e7d32" : undefined} />
              </div>

              {highCount > 0 && (
                <div style={{ background: "rgba(198,40,40,.12)", border: "1px solid rgba(198,40,40,.4)",
                  borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13, fontWeight: 800, color: "#c62828" }}>
                  🔴 {highCount} حالة تستحقّ النظر في هذه الوردية
                </div>
              )}

              {signals.length > 0 && (
                <div className="card" style={{ marginBottom: 14 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 900, marginBottom: 10 }}>⚑ ما يستحقّ النظر</h3>
                  {signals.map((s, i) => <SignalRow key={i} s={s} cur={CUR} />)}
                  <div style={{ fontSize: 11, color: "var(--sub)", marginTop: 4, lineHeight: 1.7 }}>
                    هذه مؤشّرات للمراجعة لا أحكام. لكلٍّ منها تفسير بريء وارد — اقرأها مع السياق.
                  </div>
                </div>
              )}

              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 900 }}>الخط الزمني</h3>
                  <span style={{ fontSize: 11, color: "var(--sub)" }}>{timeline.length} حركة</span>
                </div>

                {!SUPABASE_READY && (
                  <div style={{ fontSize: 12, color: "#e65100", padding: "8px 0" }}>
                    ⚠ غير متصل بالسحابة — السجل يُقرأ من Supabase فقط.
                  </div>
                )}
                {loading && <div style={{ textAlign: "center", padding: 24, color: "var(--sub)" }}>⏳ جارٍ التحميل...</div>}
                {err && <div style={{ textAlign: "center", padding: 16, color: "#c62828", fontSize: 12 }}>{err}</div>}

                {!loading && !err && !timeline.length && (
                  <div style={{ textAlign: "center", padding: 28, color: "var(--sub)", fontSize: 13 }}>
                    لا توجد حركات مسجّلة في هذه الوردية.
                    <div style={{ fontSize: 11, marginTop: 6, opacity: .75, lineHeight: 1.7 }}>
                      الورديات التي سبقت تفعيل السجل تظهر فارغة — وهذا طبيعي.
                    </div>
                  </div>
                )}

                {shown.map(r => <EventRow key={r.id} r={r} />)}

                {shown.length < timeline.length && (
                  <button onClick={() => setPage(p => p + 1)}
                    style={{ width: "100%", marginTop: 12, padding: 10, borderRadius: 10, border: "1px solid var(--border)",
                      background: "var(--card2)", color: "var(--text)", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                    عرض المزيد ({timeline.length - shown.length} متبقية)
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {view === "waste" && (
        <div className="card">
          <h3 style={{ fontSize: 14, fontWeight: 900, marginBottom: 6 }}>📉 كاشف الفاقد — آخر 90 يوماً</h3>
          <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 14, lineHeight: 1.8 }}>
            يقارن ما يقوله الجرد بما يقوله البيع. النقص العشوائي طبيعي (كسر، هدر، خطأ عدّ)؛
            أمّا الصنف الذي ينقص <b>مرّة بعد مرّة ولا يزيد أبداً</b> فيستحقّ النظر — وهو الشيء
            الوحيد الذي يكشف بضاعةً خرجت ولم يُسجَّل بيعها.
          </div>

          {!waste.length ? (
            <div style={{ textAlign: "center", padding: 28, color: "var(--sub)", fontSize: 13 }}>
              لا توجد بيانات جرد كافية بعد.
              <div style={{ fontSize: 11, marginTop: 6, opacity: .75, lineHeight: 1.7 }}>
                يبني نفسه من «الجرد الدوري». نفّذ جردين على الأقل بفارق أسابيع، ثم عُد إلى هنا.
              </div>
            </div>
          ) : (
            <>
              {waste.filter(w => w.flagged).length === 0 && (
                <div style={{ background: "rgba(46,125,50,.1)", borderRadius: 10, padding: "10px 14px",
                  marginBottom: 12, fontSize: 12.5, fontWeight: 700, color: "#2e7d32" }}>
                  ✅ لا يوجد نقص متكرّر في اتجاه واحد — الفروق ضمن الطبيعي.
                </div>
              )}
              {waste.map(w => <WasteRow key={w.itemId || w.itemName} w={w} cur={CUR} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
