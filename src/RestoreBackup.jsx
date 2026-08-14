// src/RestoreBackup.jsx — v46
// ══════════════════════════════════════════════════════════════════════
// استعادة من ملف نسخة احتياطية.
//
// المبدأ: **معاينة قبل كتابة، دائماً.** الاستعادة عملية لا رجعة فيها
// تُنفَّذ عادةً في أسوأ لحظة (بعد فقدان بيانات، تحت ضغط). واجهة تكتب
// فوراً بضغطة واحدة تُنتج كارثة ثانية فوق الأولى. لذلك: اقرأ، اعرض ما
// بالداخل وتاريخه، دع المستخدم يختار الجداول، ثم اكتب بعد تأكيد صريح.
//
// (لا مكوّن داخل مكوّن — درس v44.)
// ══════════════════════════════════════════════════════════════════════

import React, { useState, useRef } from "react";
import { readBackupFile, applyBackup } from "./lib/backup.js";
import { logActivity } from "./lib/supabase.js";

export default function RestoreBackup({ store, showToast, user }) {
  const [info, setInfo] = useState(null);      // نتيجة readBackupFile
  const [picked, setPicked] = useState([]);    // الجداول المختارة
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const fileRef = useRef(null);

  const onPick = async (e) => {
    const f = e.target.files?.[0];
    setErr(null); setInfo(null); setConfirmText("");
    if (!f) return;
    try {
      const r = await readBackupFile(f);
      setInfo(r);
      setPicked(r.preview.map(p => p.key));   // الكل مختار افتراضياً
    } catch (ex) {
      setErr(ex.message || "تعذّرت قراءة الملف");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggle = (k) => setPicked(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);

  const doRestore = () => {
    if (!info || !picked.length) return;
    setBusy(true);
    try {
      const done = applyBackup(store, info.data, picked);
      try {
        logActivity({
          action: "استعادة نسخة احتياطية",
          details: `${done.join("، ")} — من نسخة ${info.takenAt ? new Date(info.takenAt).toLocaleString("ar-SY") : "غير مؤرّخة"}`,
          userName: user?.name || "أدمن", userRole: user?.role || "admin", branch: "main",
        });
      } catch {}
      showToast?.(`✓ استُعيد: ${done.join("، ")}`, "success");
      setInfo(null); setPicked([]); setConfirmText("");
    } catch (ex) {
      showToast?.("تعذّرت الاستعادة: " + (ex.message || ""), "error");
    } finally { setBusy(false); }
  };

  const ready = picked.length > 0 && confirmText.trim() === "استعادة";

  return (
    <div style={{ borderTop: "1px dashed var(--border)", marginTop: 14, paddingTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>♻ استعادة من ملف</div>
      <div style={{ fontSize: 11, color: "var(--sub)", lineHeight: 1.7, marginBottom: 10 }}>
        اختر ملف نسخة احتياطية (JSON). سيُعرض محتواه قبل الكتابة — لا شيء يُكتب قبل تأكيدك.
        <br /><b>جرّبها مرة الآن</b> على نسخة حديثة، فالوقت غير المناسب لاكتشاف عطل هو وقت الحاجة إليها.
      </div>

      <input ref={fileRef} type="file" accept=".json,application/json" onChange={onPick}
        style={{ fontSize: 12, width: "100%", marginBottom: 8 }} />

      {err && (
        <div style={{ fontSize: 12, color: "#c62828", background: "rgba(198,40,40,.1)",
          borderRadius: 8, padding: "8px 10px", fontWeight: 700 }}>⚠ {err}</div>
      )}

      {info && (
        <div style={{ background: "var(--card2)", borderRadius: 12, padding: 14, marginTop: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 4 }}>معاينة النسخة</div>
          <div style={{ fontSize: 11, color: "var(--sub)", marginBottom: 10 }}>
            📅 {info.takenAt ? new Date(info.takenAt).toLocaleString("ar-SY") : "غير مؤرّخة"}
            {info.version != null ? ` • إصدار ${info.version}` : ""}
          </div>

          <div style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 8 }}>
            اختر ما تريد استعادته — كل جدول مختار <b>يستبدل</b> الحالي بالكامل:
          </div>

          {info.preview.map(p => (
            <label key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
              borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: 12.5 }}>
              <input type="checkbox" checked={picked.includes(p.key)} onChange={() => toggle(p.key)} />
              <span style={{ flex: 1, fontWeight: 700 }}>{p.label}</span>
              <span style={{ color: "var(--sub)", fontSize: 11 }}>{p.count} {p.unit}</span>
            </label>
          ))}

          <div style={{ background: "rgba(198,40,40,.1)", border: "1px solid rgba(198,40,40,.3)",
            borderRadius: 10, padding: "10px 12px", marginTop: 12, fontSize: 11.5, color: "#c62828", lineHeight: 1.7 }}>
            ⚠ الاستعادة تستبدل البيانات الحالية ولا يمكن التراجع عنها.
            <br />المستخدمون وكلمات المرور <b>لا تُستعاد</b> (النسخة لا تحويها) — تُدار من تبويب الموظفين.
          </div>

          <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 12, marginBottom: 6 }}>
            اكتب <b style={{ color: "#c62828" }}>استعادة</b> للتأكيد:
          </div>
          <input className="input" value={confirmText} onChange={e => setConfirmText(e.target.value)}
            placeholder="استعادة" style={{ marginBottom: 10 }} />

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={doRestore} disabled={!ready || busy}
              style={{ flex: 2, padding: 11, borderRadius: 10, border: "none", fontFamily: "inherit",
                background: ready && !busy ? "#c62828" : "var(--card)", color: ready && !busy ? "#fff" : "var(--sub)",
                fontWeight: 900, fontSize: 13, cursor: ready && !busy ? "pointer" : "not-allowed" }}>
              {busy ? "⏳ جارٍ..." : "♻ تأكيد الاستعادة"}
            </button>
            <button onClick={() => { setInfo(null); setPicked([]); setConfirmText(""); }}
              style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", fontFamily: "inherit",
                background: "var(--card)", color: "var(--text)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              تراجع
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
