// ══════════════════════════════════════════════════════════════
// mesh.js — تزامن نظير-لنظير (P2P) تجريبي عبر LAN
// ──────────────────────────────────────────────────────────────
// • اختياري ومطفأ افتراضيًا (يُفعَّل من الإعدادات: meshEnabled).
// • يحمّل المكتبات وقت التشغيل من esm.sh (لا يثقل الحزمة ولا يكسر البناء).
// • آمن الفشل: أي خطأ يُسجَّل ولا يؤثر على عمل التطبيق.
// • يزامن الطلبات عبر Y.Map مفهرسة بالمعرّف (آمن من الحلقات عبر مقارنة القيمة).
//
// حدود صادقة: الإشارة (signaling) تحتاج اتصالًا للتعارف الأولي؛ الأجهزة
// المتشابكة قبل الانقطاع تبقى متزامنة عبر LAN أثناءه. جهاز يُقلَع/يعيد
// التحميل أثناء انقطاع كامل قد لا يجد أقرانه حتى عودة الاتصال — والطبقة
// المحلية (المرحلة 1) تضمن عدم فقدان البيانات في تلك الحالة.
// ══════════════════════════════════════════════════════════════

const YJS = "https://esm.sh/yjs@13";
const YWEBRTC = "https://esm.sh/y-webrtc@10";
const YIDB = "https://esm.sh/y-indexeddb@9";

export async function startMesh({ room = "nardeen-cafe", password = "nrd-mesh-2026", onPeers, onOrders } = {}) {
  try {
    const Y = await import(/* @vite-ignore */ YJS);
    const { WebrtcProvider } = await import(/* @vite-ignore */ YWEBRTC);
    const { IndexeddbPersistence } = await import(/* @vite-ignore */ YIDB);

    const doc = new Y.Doc();
    // دوام محلي لحالة الـ mesh (يصمد أمام إعادة التحميل)
    const idb = new IndexeddbPersistence(room, doc);
    const provider = new WebrtcProvider(room, doc, { password });
    const yorders = doc.getMap("orders");

    // مستقبِل تغييرات الأقران → دمج في الحالة المحلية
    const emit = () => { try { onOrders && onOrders([...yorders.values()]); } catch {} };
    yorders.observe(emit);
    emit(); // الحالة المحفوظة محليًا فور التحميل

    // عدّاد الأقران
    let peerTimer = null;
    try {
      peerTimer = setInterval(() => {
        try { onPeers && onPeers(provider.room ? provider.room.webrtcConns.size : 0); } catch {}
      }, 2000);
    } catch {}

    return {
      // دفع الطلبات المحلية للأقران (آمن من الحلقات: لا يكتب إلا عند اختلاف فعلي)
      pushOrders(orders) {
        try {
          (orders || []).forEach(o => {
            if (!o || !o.id) return;
            const cur = yorders.get(o.id);
            if (JSON.stringify(cur) !== JSON.stringify(o)) yorders.set(o.id, o);
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
    return { pushOrders() {}, stop() {} };
  }
}
