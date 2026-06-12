import React, { useState, useEffect } from "react";
import { fetchActivity, subscribeActivity, SUPABASE_READY } from "./lib/supabase.js";
import { businessDayStart } from "./lib/utils.js";

// ══════════════════════════════════════════════════════════════
// v22: سجل النشاط — من فعل ماذا ومتى (دفع/إنشاء/إلغاء/دخول...)
// يتطلب جدول activity_log (انظر db/activity_log.sql)
// ══════════════════════════════════════════════════════════════

const ACTION_STYLE = {
  "دفع طلب":    { icon: "💰", color: "#2e7d32" },
  "دفع جزئي":   { icon: "💰", color: "#e65100" },
  "إنشاء طلب":  { icon: "🧾", color: "#1565c0" },
  "إلغاء طلب":  { icon: "🗑", color: "#c62828" },
  "تسجيل دخول": { icon: "🔑", color: "#6a1b9a" },
};

export default function ActivityLog() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let active = true;
    (async () => {
      const d = await fetchActivity(200);
      if (!active) return;
      setRows(d);
      setLoading(false);
    })();
    const unsub = subscribeActivity((r) => {
      setRows(p => [r, ...p.filter(x => x.id !== r.id)].slice(0, 300));
    });
    return () => { active = false; unsub(); };
  }, []);

  const actions = Array.from(new Set(rows.map(r => r.action))).filter(Boolean);
  const filtered = filter === "all" ? rows : rows.filter(r => r.action === filter);

  const fmt = (iso) => {
    try {
      const d = new Date(iso);
      const today = businessDayStart();
      const time = d.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
      return d >= today ? `اليوم ${time}` : `${d.toLocaleDateString("ar")} ${time}`;
    } catch { return iso || "—"; }
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontWeight: 900, fontSize: 16 }}>📋 سجل النشاط</h3>
        <span style={{ fontSize: 11, color: "var(--sub)" }}>آخر {rows.length} حركة — يتحدّث فورياً</span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {[["all", "الكل"], ...actions.map(a => [a, a])].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{
              border: "1.5px solid var(--border,#33365a)", borderRadius: 20, padding: "5px 14px",
              fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: filter === v ? "var(--accent,#2e7d32)" : "transparent",
              color: filter === v ? "#fff" : "var(--text)",
            }}>{l}</button>
        ))}
      </div>

      {loading && <div style={{ textAlign: "center", padding: 24, color: "var(--sub)" }}>⏳ جارٍ التحميل...</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 24, color: "var(--sub)", fontSize: 13 }}>
          لا توجد حركات مسجّلة بعد.
          <div style={{ fontSize: 11, marginTop: 6, opacity: .7 }}>
            إن كان الجدول غير منشأ بعد، شغّل ملف <code>db/activity_log.sql</code> في Supabase.
          </div>
        </div>
      )}

      {!loading && filtered.map(r => {
        const s = ACTION_STYLE[r.action] || { icon: "•", color: "var(--sub)" };
        return (
          <div key={r.id} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "9px 4px",
            borderBottom: "1px solid var(--border,#2a2c44)", fontSize: 13,
          }}>
            <span style={{ fontSize: 18 }}>{s.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800 }}>
                <span style={{ color: s.color }}>{r.action}</span>
                {r.order_num ? <span style={{ opacity: .8 }}> #{r.order_num}</span> : null}
                {r.amount != null && r.amount !== 0 ? <span style={{ marginInlineStart: 6, fontWeight: 700 }}>{Number(r.amount).toLocaleString()}</span> : null}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--sub)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.user_name || "—"}{r.details ? ` — ${r.details}` : ""}
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--sub)", whiteSpace: "nowrap" }}>{fmt(r.created_at)}</div>
          </div>
        );
      })}
    </div>
  );
}
