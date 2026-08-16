// src/LockModal.jsx — v47
// ══════════════════════════════════════════════════════════════════════
// نافذة فتح القفل المحاسبي — الواجهة المرافقة لـ lib/lock.js
//
// تظهر حين يحاول الأدمن تعديل طلبٍ من يوم أُرسل جرده. لا تمنع التصحيح،
// لكنها تفرض ثمناً: سبب مكتوب يُحفظ في سجل النشاط وعلى الطلب نفسه.
// هكذا يبقى التصحيح ممكناً ويبقى التلاعب مستحيلاً بلا أثر.
// ══════════════════════════════════════════════════════════════════════

import React, { useState } from "react";
import { validateReason, MIN_REASON_LEN } from "./lib/lock.js";

export function LockModal({ order, dayKey, actionLabel = "تعديل", onConfirm, onClose, CUR = "ل.س" }) {
  const [reason, setReason] = useState("");
  const check = validateReason(reason);
  const remaining = Math.max(0, MIN_REASON_LEN - reason.trim().length);

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", zIndex: 1300, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div className="card fade-in" style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 38 }}>🔓</div>
          <h3 style={{ fontWeight: 900, fontSize: 16, marginTop: 6 }}>فتح قفل محاسبي</h3>
        </div>

        <div style={{
          background: "rgba(198,40,40,.1)", border: "1.5px solid rgba(198,40,40,.35)",
          borderRadius: 10, padding: "11px 13px", marginBottom: 12,
        }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#c62828", marginBottom: 5 }}>
            ⚠ يوم {dayKey} مُقفل — أُرسل جرده
          </div>
          <div style={{ fontSize: 11, color: "var(--sub)", lineHeight: 1.9 }}>
            أرقام هذا اليوم غادرت النظام إلى تقرير تلغرام وإلى قرارات الإدارة.
            أي {actionLabel} الآن يجعل التقرير المُرسَل مخالفاً للدفتر.
            <br />سيُسجَّل هذا الإجراء باسمك مع السبب في سجل النشاط، ويُوسَم على الطلب نفسه.
          </div>
        </div>

        {order && (
          <div style={{ background: "var(--card2)", borderRadius: 9, padding: "9px 11px", marginBottom: 12, fontSize: 12, fontWeight: 800 }}>
            الطلب #{order.orderNum}
            {order.table ? ` · طاولة ${order.table}` : ""}
            <span style={{ color: "var(--sub)", fontWeight: 700 }}> · {(order.total || 0).toLocaleString()} {CUR}</span>
          </div>
        )}

        <label style={{ fontSize: 11.5, fontWeight: 800, color: "var(--sub)", display: "block", marginBottom: 5 }}>
          سبب {actionLabel} <span style={{ color: "#c62828" }}>*</span>
        </label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder="مثال: الزبون أعاد الأركيلة بعد الدفع وأُعيد له المبلغ نقداً بحضور المدير"
          style={{
            width: "100%", borderRadius: 9, border: "1.5px solid var(--border)", background: "var(--card2)",
            color: "inherit", padding: "9px 11px", fontSize: 13, fontFamily: "inherit", resize: "vertical", lineHeight: 1.7,
          }} />
        <div style={{ fontSize: 10.5, color: remaining > 0 ? "#e65100" : "#2e7d32", fontWeight: 800, margin: "5px 0 12px" }}>
          {remaining > 0 ? `يلزم ${remaining} حرفاً إضافياً على الأقل` : "✓ السبب مقبول"}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid var(--border)", background: "var(--card2)", color: "var(--text)", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
            تراجع
          </button>
          <button onClick={() => check.ok && onConfirm?.(check.reason)} disabled={!check.ok}
            style={{
              flex: 2, padding: 11, borderRadius: 10, border: "none",
              background: check.ok ? "#c62828" : "#9e9e9e", color: "#fff", fontWeight: 900,
              cursor: check.ok ? "pointer" : "not-allowed", fontFamily: "inherit",
            }}>
            🔓 افتح القفل و{actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
