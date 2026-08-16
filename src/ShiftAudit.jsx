// src/ShiftAudit.jsx — v48
// ══════════════════════════════════════════════════════════════════════
// (١) إرسال الجرد اليومي يدوياً — بديل شبكة الأمان التلقائية الملغاة
// (٢) التحقّق من بصمة الوردية — كشف أي تعديل جرى بعد الإقفال
// ══════════════════════════════════════════════════════════════════════

import React, { useState, useMemo } from "react";
import { listBusinessDays, formatDayKey, closedShiftsOfDay } from "./lib/utils.js";
import { buildDailyPacket, canSendDaily, isDayStamped, advanceStamp } from "./lib/dailyReport.js";
import { notifyTelegram, buildDailySummary } from "./lib/telegram.js";
import { claimReport, logActivity } from "./lib/supabase.js";
import { verifyShiftFingerprint, computeShiftFingerprint, LABELS } from "./lib/fingerprint.js";

// ══════════════════════════════════════════════════════════════════════
// ١) إرسال الجرد اليومي يدوياً
// ──────────────────────────────────────────────────────────────────────
// لماذا يدوي؟ لأن كل أعطال تلغرام السابقة خرجت من مؤقّت يقرّر نيابةً عن
// المستخدم. الزرّ يزيل فئة الأعطال كلها: لا مؤقّت، لا تبعيات، لا سباق
// بين أجهزة. والحجز الذرّي في report_log يبقى طبقة ثانية تمنع التكرار
// حتى لو ضغط شخصان الزرّ في اللحظة نفسها.
// ══════════════════════════════════════════════════════════════════════
export function SendDailyPanel({ store, user, settings, showToast }) {
  const CUR = settings?.currency || "ل.س";
  const days = useMemo(() => listBusinessDays(store.shifts).slice(0, 60), [store.shifts]);
  const [dayKey, setDayKey] = useState(days[0] || "");
  const [busy, setBusy] = useState(false);
  const [force, setForce] = useState(false);

  const check = useMemo(() => canSendDaily(store, dayKey), [store.shifts, dayKey]);
  const stamped = isDayStamped(settings, dayKey);
  const packet = useMemo(
    () => (dayKey ? buildDailyPacket(store, dayKey) : null),
    [store.shifts, store.orders, store.menu, dayKey]
  );
  const targets = settings?.telegramTargets || [];
  const dailyTargets = targets.filter(t => t?.events?.daily);

  const send = async () => {
    if (!dayKey || busy) return;
    if (!check.ok) { showToast?.(`⚠ ${check.reason}`, "warn"); return; }
    if (!dailyTargets.length) { showToast?.("⚠ لا توجد وجهة تلغرام مفعّلة لحدث «الجرد اليومي»", "error"); return; }

    setBusy(true);
    try {
      // الحجز الذرّي — يمنع التكرار حتى لو ضغط جهازان معاً.
      // «إعادة إرسال متعمّدة» تتخطّاه بمعرّف يحمل طابعاً زمنياً، فيبقى
      // كل إرسال مسجَّلاً بذاته في report_log ولا يُخفي التكرار.
      const claimId = force ? `daily:${dayKey}:re:${Date.now()}` : `daily:${dayKey}`;
      const claim = await claimReport(claimId, { kind: "daily", dayKey, sentBy: user?.name || "" });

      if (!claim.claimed) {
        showToast?.(
          claim.reason === "taken" || claim.reason === "local"
            ? "ℹ أُرسل جرد هذا اليوم من قبل — فعّل «إعادة إرسال متعمّدة» إن أردت تكراره"
            : "⚠ تعذّر الحجز — تحقّق من الاتصال",
          claim.reason === "taken" || claim.reason === "local" ? "warn" : "error"
        );
        return;
      }

      const p = buildDailyPacket(store, dayKey);
      notifyTelegram(dailyTargets, "daily",
        buildDailySummary(p, settings?.cafeName || "ناردين كافيه", CUR));

      try {
        logActivity({
          action: force ? "إعادة إرسال جرد يومي" : "إرسال جرد يومي يدوياً",
          details: `يوم ${dayKey} — ${p.shiftsCount} وردية — مبيعات ${p.revenue?.toLocaleString?.() || p.revenue}`,
          userName: user?.name || "", userRole: user?.role || "", amount: p.revenue,
        });
      } catch {}

      // الختم أحادي الاتجاه — لا يتراجع أبداً (سبب عطل الأيام القديمة)
      store.setSettings(prev => ({ ...prev, lastDailySent: advanceStamp(prev?.lastDailySent, dayKey) }));
      showToast?.(`📤 أُرسل جرد ${dayKey} إلى ${dailyTargets.length} وجهة`, "success");
      setForce(false);
    } catch (e) {
      showToast?.("⚠ فشل الإرسال — " + (e?.message || ""), "error");
    } finally { setBusy(false); }
  };

  const row = (l, v) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
      <span style={{ color: "var(--sub)" }}>{l}</span>
      <span style={{ fontWeight: 800 }}>{v}</span>
    </div>
  );

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 15, fontWeight: 900, marginBottom: 5 }}>📤 إرسال الجرد اليومي</h3>
      <p style={{ fontSize: 11, color: "var(--sub)", lineHeight: 1.8, marginBottom: 12 }}>
        الجرد يُرسَل تلقائياً عند إقفال آخر وردية في اليوم. هذا الزرّ لإعادة
        الإرسال أو لإرسال يومٍ فاتَه ذلك — بقرارك أنت لا بمؤقّت.
      </p>

      {!days.length ? (
        <div style={{ textAlign: "center", padding: 26, color: "var(--sub)", fontSize: 12.5 }}>
          لا توجد ورديات مقفلة بعد
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12 }} className="scroll-hide">
            {days.map(d => (
              <button key={d} onClick={() => setDayKey(d)}
                style={{
                  flexShrink: 0, padding: "6px 12px", borderRadius: 16, border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontWeight: 800, fontSize: 11.5,
                  background: dayKey === d ? "#1565c0" : "var(--card2)",
                  color: dayKey === d ? "#fff" : "var(--sub)",
                }}>
                {d}{isDayStamped(settings, d) ? " ✓" : ""}
              </button>
            ))}
          </div>

          {packet && (
            <div style={{ background: "var(--card2)", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 900, marginBottom: 6 }}>{formatDayKey(dayKey)}</div>
              {row("الورديات", `${packet.shiftsCount}${packet.sequence ? ` — ${packet.sequence}` : ""}`)}
              {row("المبيعات", `${(packet.revenue || 0).toLocaleString()} ${CUR}`)}
              {row("فرق الصندوق", `${(packet.variance || 0).toLocaleString()} ${CUR}`)}
              {row("عدد الطلبات", packet.orders || 0)}
            </div>
          )}

          {!check.ok && (
            <div style={{ background: "rgba(230,81,0,.12)", borderRadius: 9, padding: "8px 11px", fontSize: 11.5, fontWeight: 800, color: "#e65100", marginBottom: 10 }}>
              ⚠ {check.reason}
            </div>
          )}

          {stamped && check.ok && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--sub)" }}>
                أُرسل هذا اليوم من قبل — إعادة إرسال متعمّدة
              </span>
            </label>
          )}

          {!dailyTargets.length && (
            <div style={{ background: "rgba(198,40,40,.1)", borderRadius: 9, padding: "8px 11px", fontSize: 11.5, fontWeight: 800, color: "#c62828", marginBottom: 10 }}>
              ⚠ لا توجد وجهة تلغرام مفعّل فيها حدث «الجرد اليومي» — فعّلها من الإعدادات
            </div>
          )}

          <button onClick={send} disabled={busy || !check.ok || !dailyTargets.length}
            style={{
              width: "100%", border: "none", borderRadius: 10, padding: 12, fontWeight: 900, fontSize: 13.5,
              fontFamily: "inherit", color: "#fff",
              background: (busy || !check.ok || !dailyTargets.length) ? "#9e9e9e" : "#1565c0",
              cursor: (busy || !check.ok || !dailyTargets.length) ? "not-allowed" : "pointer",
            }}>
            {busy ? "⏳ جارٍ الإرسال…" : `📤 أرسل جرد ${dayKey}`}
          </button>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ٢) بصمة الوردية — التحقّق
// ──────────────────────────────────────────────────────────────────────
// تُحسَب لحظة الإقفال وتُخزَّن مع الوردية. هنا يُعاد الحساب ويُقارَن.
// تطابق ⇒ إثبات أن شيئاً لم يُمسّ. اختلاف ⇒ إثبات قاطع مع تحديد الجزء.
// ══════════════════════════════════════════════════════════════════════
export function FingerprintPanel({ store, settings, user, showToast }) {
  const [results, setResults] = useState({});   // shiftId -> نتيجة
  const [busy, setBusy] = useState({});

  const closed = useMemo(() =>
    (store.shifts || [])
      .filter(s => s.status === "closed" && s.closedAt)
      .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
      .slice(0, 30),
    [store.shifts]);

  const sources = {
    orders: store.orders || [],
    expenses: store.expenses || [],
    stockMoves: store.stockMoves || [],
  };

  const verify = async (sh) => {
    setBusy(b => ({ ...b, [sh.id]: true }));
    try {
      const r = await verifyShiftFingerprint(sh, sources);
      setResults(p => ({ ...p, [sh.id]: r }));
      if (r.state === "changed") {
        showToast?.(`⛔ تغيّرت بيانات الوردية بعد إقفالها — ${r.changed.map(c => c.label).join("، ")}`, "error");
        try {
          logActivity({
            action: "⛔ كشف تعديل بعد الإقفال",
            details: `وردية ${sh.id} (${sh.businessDay || ""}) — تغيّر: ${r.changed.map(c => c.label).join("، ")}`,
            userName: user?.name || "", userRole: user?.role || "", branch: sh.branch || "main",
          });
        } catch {}
      } else if (r.state === "intact") showToast?.("✅ البصمة مطابقة — لم يُمسّ شيء منذ الإقفال", "success");
      else if (r.state === "none") showToast?.("ℹ هذه الوردية أُقفلت قبل تفعيل البصمة", "warn");
      else showToast?.("⚠ البصمة غير متاحة في هذا المتصفح", "warn");
    } finally {
      setBusy(b => { const n = { ...b }; delete n[sh.id]; return n; });
    }
  };

  const verifyAll = async () => {
    for (const sh of closed) { if (sh.fingerprint) await verify(sh); }
  };

  const badge = (r) => {
    if (!r) return null;
    const map = {
      intact:      ["✅ مطابقة", "#2e7d32", "rgba(46,125,50,.12)"],
      changed:     ["⛔ تغيّرت", "#c62828", "rgba(198,40,40,.14)"],
      none:        ["— بلا بصمة", "var(--sub)", "var(--card2)"],
      unavailable: ["⚠ غير متاح", "#e65100", "rgba(230,81,0,.12)"],
    };
    const [txt, color, bg] = map[r.state] || map.none;
    return <span style={{ fontSize: 10.5, fontWeight: 900, color, background: bg, borderRadius: 7, padding: "2px 8px" }}>{txt}</span>;
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
        <h3 style={{ fontSize: 15, fontWeight: 900 }}>🔏 بصمة الوردية</h3>
        <button onClick={verifyAll}
          style={{ background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 8, padding: "6px 13px", fontWeight: 800, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
          تحقّق من الكل
        </button>
      </div>
      <p style={{ fontSize: 11, color: "var(--sub)", lineHeight: 1.8, marginBottom: 12 }}>
        بصمة تشفيرية تُحسَب لحظة الإقفال على محتوى الوردية. إعادة حسابها الآن
        تُثبت رياضياً هل مُسّت الأرقام بعد الإقفال — وأي جزء منها بالضبط.
      </p>

      {!closed.length ? (
        <div style={{ textAlign: "center", padding: 26, color: "var(--sub)", fontSize: 12.5 }}>لا توجد ورديات مقفلة</div>
      ) : closed.map(sh => {
        const r = results[sh.id];
        const typeLbl = sh.shiftType === "morning" ? "صباحية" : sh.shiftType === "evening" ? "مسائية" : sh.shiftType === "night" ? "ليلية" : "—";
        return (
          <div key={sh.id} style={{
            background: r?.state === "changed" ? "rgba(198,40,40,.08)" : "var(--card2)",
            border: r?.state === "changed" ? "1.5px solid rgba(198,40,40,.4)" : "1px solid transparent",
            borderRadius: 10, padding: "9px 11px", marginBottom: 6,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 800 }}>
                {sh.businessDay || "—"} · {typeLbl}
                <span style={{ color: "var(--sub)", fontWeight: 600 }}> · {sh.userName || ""}</span>
              </span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {badge(r)}
                {!sh.fingerprint && !r && (
                  <span style={{ fontSize: 10, color: "var(--sub)", fontWeight: 700 }}>بلا بصمة</span>
                )}
                {sh.fingerprint && (
                  <button onClick={() => verify(sh)} disabled={!!busy[sh.id]}
                    style={{
                      background: "transparent", border: "1px solid var(--border)", borderRadius: 7,
                      padding: "4px 10px", fontWeight: 800, fontSize: 11, color: "var(--sub)",
                      cursor: busy[sh.id] ? "wait" : "pointer", fontFamily: "inherit",
                    }}>
                    {busy[sh.id] ? "…" : "تحقّق"}
                  </button>
                )}
              </span>
            </div>

            {sh.fingerprint?.all && (
              <div style={{ fontSize: 10, color: "var(--sub)", fontFamily: "monospace", marginTop: 4, direction: "ltr", textAlign: "left" }}>
                {sh.fingerprint.all}
              </div>
            )}

            {r?.state === "changed" && (
              <div style={{ marginTop: 8, background: "rgba(198,40,40,.1)", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 900, color: "#c62828", marginBottom: 5 }}>
                  تغيّر بعد الإقفال:
                </div>
                {r.changed.map(c => (
                  <div key={c.key} style={{ fontSize: 11, color: "#c62828", lineHeight: 1.9 }}>
                    • {c.label}
                    {c.before != null && c.after != null && c.before !== c.after && (
                      <b> — العدد {c.before} ← {c.after}</b>
                    )}
                  </div>
                ))}
                <div style={{ fontSize: 10.5, color: "var(--sub)", marginTop: 6, lineHeight: 1.7 }}>
                  راجع سجل النشاط في هذا النطاق الزمني لمعرفة مَن نفّذ التعديل ولماذا.
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// شاشة موحّدة تجمع الأداتين
export default function ShiftAudit({ store, user, settings, showToast }) {
  return (
    <div className="fade-in">
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 14 }}>🔏 تدقيق الورديات</h2>
      <SendDailyPanel store={store} user={user} settings={settings} showToast={showToast} />
      <FingerprintPanel store={store} user={user} settings={settings} showToast={showToast} />
    </div>
  );
}
