import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// داخل تطبيق أندرويد (APK): ألغِ أي Service Worker حتى يُحمَّل دائمًا الإصدار
// المُضمَّن في الـAPK (تحديث نظيف). لا أثر على الـPWA في المتصفّح.
if (typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.()) {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
  }
}

const btn = (bg) => ({
  background: bg, color: "#fff", border: "none", borderRadius: 10,
  padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
});

async function hardReset() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) { /* تجاهل */ }
  location.reload();
}

class RootErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("[App crash]", err, info); }
  render() {
    if (this.state.err) {
      return (
        <div dir="rtl" style={{ minHeight: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center",
          fontFamily: "Tajawal,Cairo,sans-serif", background: "#0f0f1a", color: "#fff" }}>
          <div style={{ fontSize: 42 }}>☕</div>
          <h2 style={{ fontSize: 20, fontWeight: 900 }}>حدث خطأ غير متوقّع</h2>
          <p style={{ opacity: .7, fontSize: 14, maxWidth: 330 }}>جرّب إعادة التحميل. إن تكرّر، اضغط «إصلاح» (يتطلب إنترنت).</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={() => location.reload()} style={btn("#c62828")}>إعادة التحميل</button>
            <button onClick={hardReset} style={btn("#444")}>إصلاح</button>
          </div>
          <pre style={{ marginTop: 10, fontSize: 11, opacity: .5, maxWidth: 330, overflow: "auto", direction: "ltr" }}>
            {String((this.state.err && this.state.err.message) || this.state.err)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
