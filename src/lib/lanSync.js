// lanSync.js — عميل المزامنة عبر الشبكة المحلية (LAN) داخل تطبيق أندرويد.
// يتصل بخادم الكاشير المحلي (NanoHTTPD) عبر CapacitorHttp الأصلي
// لتفادي قيود CORS و mixed-content في الـ WebView.
import { Capacitor, CapacitorHttp } from "@capacitor/core";

export const PORT = 8787;
export const isNativeApp = () => { try { return Capacitor.isNativePlatform(); } catch { return false; } };

// cfg = { enabled, role: "cashier"|"client", ip }
export function lanBase(cfg) {
  if (!cfg || !cfg.enabled) return null;
  if (cfg.role === "cashier") return `http://127.0.0.1:${PORT}`;
  if (cfg.ip) return `http://${cfg.ip}:${PORT}`;
  return null;
}

async function req(base, method, path, data) {
  const res = await CapacitorHttp.request({
    method, url: base + path,
    headers: { "Content-Type": "application/json" },
    data: data || undefined,
    connectTimeout: 4000, readTimeout: 4000,
  });
  const d = res?.data;
  if (typeof d === "string") { try { return JSON.parse(d); } catch { return d; } }
  return d;
}

export async function lanPing(base) { try { return await req(base, "GET", "/ping"); } catch { return null; } }
export async function lanMyIp(base) { try { const o = await req(base, "GET", "/ip"); return o?.ip || null; } catch { return null; } }
export async function lanChanges(base, since) { return req(base, "GET", `/changes?since=${since || 0}`); }
export async function lanPush(base, table, row) { return req(base, "POST", "/push", { table, row }); }
export async function lanReset(base) { try { return await req(base, "POST", "/reset"); } catch { return null; } }
