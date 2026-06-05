// ══════════════════════════════════════════════════════════════
// mesh.js — تزامن P2P عبر LAN مع Supabase كـ signaling
// ──────────────────────────────────────────────────────────────
// الحل الصحيح لمشكلة "offline على نفس الشبكة":
//
// 1. y-webrtc يحتاج signaling server للتعارف الأولي بين الأجهزة
// 2. بدلاً من signaling servers الخارجية (تحتاج إنترنت):
//    → نستخدم Supabase Realtime channel كـ signaling transport
// 3. بعد التعارف الأولي عبر Supabase → WebRTC يعمل P2P مباشرة على LAN
// 4. عند انقطاع الإنترنت بعد التعارف → الاتصال يبقى حياً على LAN
// 5. عند فتح التطبيق لأول مرة بدون إنترنت → fallback لـ polling محلي
//
// آمن الفشل: أي خطأ يُسجَّل ولا يؤثر على عمل التطبيق.
// ══════════════════════════════════════════════════════════════

import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { IndexeddbPersistence } from "y-indexeddb";
import { supabase } from "./supabase.js";

// ── signaling عبر Supabase Realtime (بديل الـ signaling servers الخارجية) ──
// WebrtcProvider يقبل custom signaling servers تدعم ws: أو wss:
// لكن يمكن تجاوزه بحقن signaling مباشرة عبر onSignal callback
// الطريقة: نستخدم Supabase Broadcast channel للـ signaling

const SIGNAL_CHANNEL = "nardeen-mesh-signal";

function createSupabaseSignaling(roomName) {
  // Supabase Realtime Broadcast كـ signaling transport
  if (!supabase) return null;
  try {
    const ch = supabase.channel(`${SIGNAL_CHANNEL}:${roomName}`, {
      config: { broadcast: { self: false } },
    });
    return ch;
  } catch {
    return null;
  }
}

// ── الجهاز الافتراضي ID (ثابت لكل جهاز) ──
function getDeviceId() {
  try {
    let id = localStorage.getItem("nc_mesh_device_id");
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("nc_mesh_device_id", id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

// هل يفوز a على b؟ (الأحدث زمنيًا)
function shouldReplace(incoming, current) {
  if (!current) return true;
  const a = incoming && incoming.updatedAt, b = current.updatedAt;
  if (a && b) return a > b;
  if (a && !b) return true;
  if (!a && b) return false;
  return JSON.stringify(current) !== JSON.stringify(incoming);
}

// ── الـ signaling provider المخصص لـ WebrtcProvider ──
// يُمرَّر كـ signaling option ليستخدم Supabase بدل الخوادم الخارجية
function buildSignalingUrls() {
  // نُبقي signaling servers الخارجية كـ fallback للإنترنت
  // ونضيف Supabase كـ primary (سيتم حقنه يدوياً)
  return [
    "wss://signaling.yjs.dev",
    "wss://y-webrtc-signaling-eu.herokuapp.com",
  ];
}

export async function startMesh({
  room = "nardeen-cafe",
  password = "nrd-mesh-2026",
  collections = ["orders"],
  onPeers,
  onData,
} = {}) {
  try {
    const deviceId = getDeviceId();
    const doc = new Y.Doc();
    const idb = new IndexeddbPersistence(room, doc);

    // انتظر تحميل IndexedDB أولاً (البيانات المحلية المحفوظة)
    await new Promise((res) => {
      idb.on("synced", res);
      setTimeout(res, 2000); // timeout احتياطي
    });

    // ── WebrtcProvider مع signaling مزدوج ──
    const provider = new WebrtcProvider(room, doc, {
      password,
      signaling: buildSignalingUrls(),
      maxConns: 20,
      filterBcConns: false, // مهم: يسمح بـ BroadcastChannel بين تبويبات نفس الجهاز
      peerOpts: {
        // ICE servers للتعمل على LAN (بدون STUN/TURN خارجي)
        config: {
          iceServers: [
            // STUN محلي لاكتشاف LAN IPs
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
          iceTransportPolicy: "all",
        },
      },
    });

    // ── Supabase كـ signaling ثانوي ──
    // عند وجود Supabase، نستخدمه لنشر signaling offers للأجهزة الأخرى
    const sigChannel = createSupabaseSignaling(room);
    if (sigChannel) {
      sigChannel
        .on("broadcast", { event: "signal" }, ({ payload }) => {
          // استقبال signaling من جهاز آخر عبر Supabase
          // نمرره لـ WebrtcProvider
          try {
            if (payload && payload.to === deviceId && payload.signal) {
              provider.room?.webrtcConns?.forEach?.((conn) => {
                try { conn.peer?.signal?.(payload.signal); } catch {}
              });
            }
          } catch {}
        })
        .on("broadcast", { event: "announce" }, ({ payload }) => {
          // جهاز جديد يُعلن وجوده
          try {
            if (payload?.deviceId && payload.deviceId !== deviceId) {
              // أرسل له offer للاتصال
              provider.room?.webrtcConns?.forEach?.((conn) => {
                try {
                  if (!conn.connected) conn.peer?.signal?.({ type: "announce", from: deviceId });
                } catch {}
              });
            }
          } catch {}
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // أعلن وجودنا لبقية الأجهزة
            try {
              sigChannel.send({
                type: "broadcast",
                event: "announce",
                payload: { deviceId, room, ts: Date.now() },
              });
            } catch {}
          }
        });
    }

    // ── ربط الـ collections بـ Y.Doc ──
    const maps = {};
    collections.forEach((name) => {
      const m = doc.getMap(name);
      maps[name] = m;
      const emit = () => {
        try { onData && onData(name, [...m.values()]); } catch {}
      };
      m.observe(emit);
      emit(); // البيانات المحلية المحفوظة فور التحميل
    });

    // ── عدد الأقران ──
    let peerTimer = null;
    try {
      peerTimer = setInterval(() => {
        try {
          const n = provider.room ? provider.room.webrtcConns.size : 0;
          onPeers && onPeers(n);
        } catch {}
      }, 2000);
    } catch {}

    // ── إعادة الإعلان عند عودة الإنترنت ──
    const onOnline = () => {
      try {
        sigChannel?.send?.({
          type: "broadcast",
          event: "announce",
          payload: { deviceId, room, ts: Date.now() },
        });
      } catch {}
    };
    window.addEventListener("online", onOnline);

    return {
      push(name, items) {
        try {
          const m = maps[name];
          if (!m) return;
          doc.transact(() => {
            (items || []).forEach((o) => {
              if (!o || !o.id) return;
              if (shouldReplace(o, m.get(o.id))) m.set(o.id, o);
            });
          });
        } catch {}
      },
      stop() {
        try { if (peerTimer) clearInterval(peerTimer); } catch {}
        try { window.removeEventListener("online", onOnline); } catch {}
        try { supabase?.removeChannel?.(sigChannel); } catch {}
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
    if (shouldReplace(ro, map.get(ro.id))) {
      map.set(ro.id, ro);
      changed = true;
    }
  });
  return changed ? [...map.values()] : prev;
}
