import React, { useState, useEffect } from "react";
import { isNativeApp, lanBase, lanMyIp, lanPing, lanReset } from "./lib/lanSync.js";
import { Preferences } from "@capacitor/preferences";

// بطاقة التحكم بالمزامنة المحلية (LAN). متاحة للأدمن والكاشير.
// تكتب الدور/التفعيل إلى تخزين أندرويد الأصلي ليقرأه التطبيق ويشغّل
// الخادم على الكاشير فقط (يسري بعد إعادة فتح التطبيق).
export default function LanCard({ store, showToast }) {
  const lan = store.settings?.lan || { enabled: false, role: "client", ip: "" };
  const native = isNativeApp();
  const [myIp, setMyIp] = useState("");
  const [status, setStatus] = useState("…");

  const update = (patch) => {
    const next = { ...lan, ...patch };
    store.setSettings({ ...store.settings, lan: next });
    // مزامنة مع التخزين الأصلي ليقرر التطبيق تشغيل الخادم على الكاشير فقط
    try {
      Preferences.set({ key: "lan_enabled", value: next.enabled ? "true" : "false" });
      Preferences.set({ key: "lan_role", value: next.role || "client" });
    } catch {}
  };

  useEffect(() => {
    if (!native || !lan.enabled) { setStatus("متوقّف"); return; }
    const base = lanBase(lan); if (!base) { setStatus("أدخل عنوان الكاشير"); return; }
    let stop = false;
    const check = async () => {
      const p = await lanPing(base); if (stop) return;
      setStatus(p ? "متصل ✓" : "غير متصل ✗");
      if (lan.role === "cashier") { const ip = await lanMyIp(base); if (!stop && ip) setMyIp(ip); }
    };
    check(); const iv = setInterval(check, 3000);
    return () => { stop = true; clearInterval(iv); };
  }, [native, lan.enabled, lan.role, lan.ip]);

  const btn = (active) => ({ flex: 1, padding: "9px", borderRadius: 9, fontWeight: 800, fontSize: 13, border: "1px solid " + (active ? "#c62828" : "var(--border)"), background: active ? "#c62828" : "var(--card2)", color: active ? "#fff" : "var(--text)", cursor: "pointer" });

  return (
    <div className="card">
      <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 14, color: "#c62828" }}>📡 المزامنة المحلية (بلا إنترنت)</h3>
      {!native && <div style={{ fontSize: 12, color: "var(--sub)", marginBottom: 12, lineHeight: 1.7 }}>تعمل فقط داخل تطبيق أندرويد المثبّت (APK)، وليس من المتصفّح.</div>}
      <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, fontWeight: 700 }}>
        تفعيل المزامنة المحلية
        <input type="checkbox" checked={!!lan.enabled} onChange={e => update({ enabled: e.target.checked })} style={{ width: 20, height: 20 }} />
      </label>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>دور هذا الجهاز</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button style={btn(lan.role === "cashier")} onClick={() => update({ role: "cashier" })}>الكاشير (المركز)</button>
        <button style={btn(lan.role !== "cashier")} onClick={() => update({ role: "client" })}>جهاز عادي</button>
      </div>
      {lan.role === "cashier" ? (
        <div style={{ background: "var(--card2)", borderRadius: 9, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "var(--sub)" }}>عنوان هذا الجهاز (أدخله في باقي الأجهزة):</div>
          <div style={{ fontSize: 20, fontWeight: 900, direction: "ltr", textAlign: "center" }}>{myIp || "…"}</div>
        </div>
      ) : (
        <input className="input" placeholder="عنوان الكاشير مثل 192.168.1.50" value={lan.ip || ""}
          onChange={e => update({ ip: e.target.value.trim() })} style={{ marginBottom: 12, direction: "ltr", textAlign: "center" }} />
      )}
      <div style={{ fontSize: 13, marginBottom: 12 }}>الحالة: <b>{status}</b></div>
      {lan.role === "cashier" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={async () => { const b = lanBase(lan); if (b) { await lanReset(b); showToast?.("تم تصفير ترقيم الطلبات ✓"); } }}
            style={{ width: "100%", padding: "9px", borderRadius: 9, border: "1px solid #c62828", background: "transparent", color: "#c62828", fontWeight: 800, cursor: "pointer" }}>
            تصفير ترقيم الطلبات
          </button>
          <div style={{ fontSize: 11, color: "var(--sub)", lineHeight: 1.6 }}>تغيير الدور/التفعيل يسري بعد إغلاق التطبيق وفتحه من جديد.</div>
        </div>
      )}
    </div>
  );
}
