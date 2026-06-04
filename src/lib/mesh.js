// ══════════════════════════════════════════════════════════════
// mesh.js — تزامن نظير-لنظير (P2P) تجريبي عبر LAN (عدة مجموعات)
// ──────────────────────────────────────────────────────────────
// • اختياري ومطفأ افتراضيًا (يُفعَّل من الإعدادات: meshEnabled).
// • يستورد المكتبات محليًا (مضمّنة في الحزمة) → تعمل أوفلاين بلا اعتماد خارجي.
// • آمن الفشل: أي خطأ يُسجَّل ولا يؤثر على عمل التطبيق.
// • كل مجموعة = Y.Map مفهرسة بالمعرّف. حلّ التعارض: الأحدث (updatedAt) يفوز،
//   وإلا مقارنة القيمة (آمن من الحلقات).
//
// حدود صادقة: الإشارة (signaling) تحتاج اتصالًا للتعارف الأولي؛ الأجهزة
// المتشابكة قبل الانقطاع تبقى متزامنة عبر LAN أثناءه. جهاز يُقلَع أثناء
// انقطاع كامل قد لا يجد أقرانه حتى عودة الاتصال — والطبقة المحلية تمنع الفقدان.
// ملاحظة: المخزون (menu) غير مشمول بعد لتفادي ضياع الخصم؛ يحتاج CRDT حركات.
// ══════════════════════════════════════════════════════════════

import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { IndexeddbPersistence } from "y-indexeddb";

// هل يفوز a على b؟ (الأحدث زمنيًا، وإلا اختلاف فعلي)
function shouldReplace(incoming, current) {
  if (!current) return true;
  const a = incoming && incoming.updatedAt, b = current.updatedAt;
  if (a && b) return a > b;
  if (a && !b) return true;
  if (!a && b) return false;
  return JSON.stringify(current) !== JSON.stringify(incoming);
}

export async function startMesh({ room = "nardeen-cafe", password = "nrd-mesh-2026",
  collections = ["orders"], onPeers, onData } = {}) {
  try {
    const doc = new Y.Doc();
    const idb = new IndexeddbPersistence(room, doc);
    const provider = new WebrtcProvider(room, doc, { password });

    const maps = {};
    collections.forEach((name) => {
      const m = doc.getMap(name);
      maps[name] = m;
      const emit = () => { try { onData && onData(name, [...m.values()]); } catch {} };
      m.observe(emit);
      emit(); // الحالة المحفوظة محليًا فور التحميل
    });

    let peerTimer = null;
    try {
      peerTimer = setInterval(() => {
        try { onPeers && onPeers(provider.room ? provider.room.webrtcConns.size : 0); } catch {}
      }, 2000);
    } catch {}

    return {
      // دفع مجموعة محلية للأقران (الأحدث يفوز، آمن من الحلقات)
      push(name, items) {
        try {
          const m = maps[name]; if (!m) return;
          (items || []).forEach((o) => {
            if (!o || !o.id) return;
            if (shouldReplace(o, m.get(o.id))) m.set(o.id, o);
          });
        } catch {}
      },
      stop() {
        try { if (peerTimer) clearInterval(peerTimer); } catch {}
        try { provider.destroy(); } catch {}
        try { idb.destroy && idb.destroy(); } catch {}
        try { doc.destroy(); } catch {}
      },
    };
  } catch (e) {
    console.warn("[mesh] تعذّر بدء الـ mesh (آمن — التطبيق يعمل عبر السحابة):", e);
    return { push() {}, stop() {} };
  }
}

// دمج عناصر واردة في مصفوفة محلية (حسب المعرّف + الأحدث يفوز)
export function mergeById(prev, incoming) {
  const map = new Map((prev || []).map((o) => [o.id, o]));
  let changed = false;
  (incoming || []).forEach((ro) => {
    if (!ro || !ro.id) return;
    if (shouldReplace(ro, map.get(ro.id))) { map.set(ro.id, ro); changed = true; }
  });
  return changed ? [...map.values()] : prev;
}
