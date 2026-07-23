// src/lib/utils.js — Nardeen Caffe v6.0
// ══════════════════════════════════════════════════════════════
// v30.3: اليوم المحاسبي (Business Day) — يبدأ الساعة 1 صباحاً لا منتصف الليل
//  يطابق دورة العمل: المسائي يختم اليوم (12–1)، الليلي يبدأ التالي.
//  كل حسابات "اليوم" تستخدم businessDayStart بدل setHours(0,0,0,0).
// ══════════════════════════════════════════════════════════════
export const BUSINESS_DAY_CUTOFF_HOUR = 1; // ساعة بداية اليوم المحاسبي
export const businessDayStart = (ref = new Date()) => {
  const d = new Date(ref);
  if (d.getHours() < BUSINESS_DAY_CUTOFF_HOUR) d.setDate(d.getDate() - 1);
  d.setHours(BUSINESS_DAY_CUTOFF_HOUR, 0, 0, 0);
  return d;
};

// v37: بداية يوم العمل = افتتاح آخر وردية (الليلية) — لا ساعة ثابتة.
// يوم العمل يمتدّ من لحظة فتح الوردية الحالية. إن لم توجد ورديات بعد،
// نرجع إلى businessDayStart (ساعة القطع) كحلٍّ احتياطي.
export const workDayStart = (shifts, branch = "main", ref = new Date()) => {
  const now = new Date(ref).getTime();
  const opens = (shifts || [])
    .filter(s => (s.branch || "main") === branch && s.openedAt && new Date(s.openedAt).getTime() <= now)
    .map(s => new Date(s.openedAt).getTime())
    .sort((a, b) => b - a);
  return opens.length ? new Date(opens[0]) : businessDayStart(ref);
};
export const businessDayLabel = (ref = new Date()) =>
  businessDayStart(ref).toLocaleDateString("ar-SY", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// v31.1: بداية الأسبوع = أحدث يوم خميس (الأسبوع من الخميس إلى الخميس) عند ساعة القطع
export const weekStartThursday = (ref = new Date()) => {
  const d = businessDayStart(ref);
  const diff = (d.getDay() - 4 + 7) % 7; // 4 = الخميس
  d.setDate(d.getDate() - diff);
  return d;
};


// تحسينات v6:
//  - تنبيه نفاد المخزون (checkStockAlerts)
//  - إرسال الفاتورة واتساب (sendReceiptWhatsApp)
//  - طباعة تذكرة المطبخ/البار (printKitchenTicket)
//  - نظام الولاء (getLoyaltyStatus, applyLoyaltyReward)
//  - دفع جزئي (splitPaymentHTML)
//  - تقرير الموظف الأفضل (getStaffReport)
//  - خريطة الذروة (getPeakHoursData)
//  - مقارنة المبيعات (getSalesComparison)
// ══════════════════════════════════════════════════════════════

// ── تشفير كلمات المرور — SHA-256 (نقي، في الحزمة الرئيسية لعمل الدخول أوفلاين) ──
export const hashPassword = async (plain) => {
  if (!plain) return plain;
  if (/^[a-f0-9]{64}$/i.test(plain)) return plain; // مشفّرة مسبقًا
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
};

export const verifyPassword = async (plain, hashed) => {
  if (plain === hashed) return true; // دعم القديم غير المشفّر
  const h = await hashPassword(plain);
  return h === hashed;
};

// ── صوت التنبيه ───────────────────────────────────────────────
export const playOrderAlert = (tone = "bell") => {
  try {
    if (tone === "custom") {
      let d = null; try { d = localStorage.getItem("nc_sound_custom"); } catch {}
      if (d) { const a = new Audio(d); a.play().catch(() => {}); return; }
      tone = "bell"; // لا توجد نغمة مخصّصة محفوظة → افتراضي
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = (freq, start, dur = 0.18, vol = 0.3) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(vol, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur);
    };
    // أنماط نغمات مميّزة — ليختار كل جهاز نغمته الخاصة
    const patterns = {
      bell:  [[880, 0], [660, 0.12]],
      chime: [[1046, 0], [784, 0.15], [1318, 0.3]],
      ping:  [[1200, 0]],
      beep:  [[440, 0]],
      alarm: [[988, 0], [988, 0.2], [988, 0.4]],
      drop:  [[1318, 0], [988, 0.12], [659, 0.24]],
      rise:  [[523, 0], [784, 0.12], [1046, 0.24]],
      trill: [[1046, 0], [1318, 0.08], [1046, 0.16], [1318, 0.24]],
    };
    (patterns[tone] || patterns.bell).forEach(([f, t]) => beep(f, t));
  } catch {}
};

// قائمة النغمات المتاحة (للاختيار في الإعدادات)
export const SOUND_TONES = [
  { id: "bell", label: "🔔 جرس" }, { id: "chime", label: "🎐 رنين" },
  { id: "ping", label: "📍 بِنغ" }, { id: "beep", label: "🔉 بيب" },
  { id: "alarm", label: "🚨 إنذار" }, { id: "drop", label: "💧 هابطة" },
  { id: "rise", label: "📈 صاعدة" }, { id: "trill", label: "🎵 تموّج" },
];

// ══════════════════════════════════════════════════════════════
// 5. تنبيه نفاد المخزون
// ══════════════════════════════════════════════════════════════
/**
 * يُعيد قائمة الأصناف التي وصلت لـ minStock أو أقل
 * @param {Array} menu
 * @returns {Array} lowItems
 */
export const checkStockAlerts = (menu) => {
  // v28: تنبيه فقط عند نفاد فعلي (أقل من 1) للأصناف الحقيقية — المفتوحة/الخدمية لا تُنبّه
  return menu.filter(m => m.active && m.trackStock !== false && !m.noStock && (m.stock || 0) < 1);
};

/**
 * يُشغّل تنبيه صوتي + browser notification عند نفاد مخزون
 */
export const notifyLowStock = (items, settings) => {
  if (!items.length) return;
  // صوت تنبيه مختلف (تنبيه خطر)
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.setValueAtTime(330, ctx.currentTime + 0.15);
    osc.frequency.setValueAtTime(220, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
  } catch {}

  if (settings?.notifyBrowser && Notification?.permission === "granted") {
    const names = items.slice(0, 3).map(i => i.name).join("، ");
    new Notification("⚠️ مخزون منخفض — ناردين كافيه", {
      body: `${names}${items.length > 3 ? ` و${items.length - 3} أصناف أخرى` : ""} وصلت للحد الأدنى`,
      icon: "/favicon.ico",
    }).catch(() => {});
  }
};

// ══════════════════════════════════════════════════════════════
// 12. إرسال الفاتورة واتساب
// ══════════════════════════════════════════════════════════════
/**
 * يفتح واتساب مع نص الفاتورة جاهز للإرسال
 * @param {Object} order - الطلب
 * @param {string} phone - رقم الهاتف (اختياري)
 * @param {Object} settings
 */
export const sendReceiptWhatsApp = (order, phone, settings) => {
  const CUR = settings?.currency || "ل.س";
  const cafeName = settings?.cafeName || "Nardeen Caffe";
  const now = new Date();
  const dateStr = now.toLocaleDateString("ar-SY");
  const timeStr = now.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });

  const itemsText = (order.items || [])
    .map(it => `  • ${it.emoji || ""} ${it.itemName} ×${it.qty} — ${(it.price * it.qty).toLocaleString()} ${CUR}`)
    .join("\n");

  const payLabel = order.paymentType === "cash" ? "نقدي" :
    order.paymentType === "card" ? "بطاقة" :
    order.paymentType === "tron" ? "ترون" :
    order.paymentType === "debt" ? "دين" : (order.paymentType || "نقدي");

  const msg = `☕ *${cafeName}*\n` +
    `${settings?.signature || ""}\n` +
    `────────────────\n` +
    `📋 *فاتورة رقم:* #${order.orderNum || order.id}\n` +
    `📅 ${dateStr} — ${timeStr}\n` +
    (order.table ? `🪑 *الطاولة:* ${order.table}\n` : "") +
    (order.customerName ? `👤 *الزبون:* ${order.customerName}\n` : "") +
    `────────────────\n` +
    `${itemsText}\n` +
    `────────────────\n` +
    ((order.discount || 0) > 0 ? `💰 قبل الخصم: ${(order.originalTotal || order.total).toLocaleString()} ${CUR}\n` +
      `🎁 خصم ${order.discount}%: -${((order.originalTotal || 0) - order.total).toLocaleString()} ${CUR}\n` : "") +
    `✅ *الإجمالي: ${(order.total || 0).toLocaleString()} ${CUR}*\n` +
    `💳 الدفع: ${payLabel}\n` +
    `────────────────\n` +
    `شكراً لزيارتكم 🙏`;

  const encodedMsg = encodeURIComponent(msg);
  // إذا كان هناك رقم، أرسل مباشرة. وإلا افتح واتساب للاختيار
  const phoneClean = phone ? phone.replace(/[^0-9]/g, "").replace(/^0/, "963") : "";
  const url = phoneClean
    ? `https://wa.me/${phoneClean}?text=${encodedMsg}`
    : `https://wa.me/?text=${encodedMsg}`;

  window.open(url, "_blank");
};

// ══════════════════════════════════════════════════════════════
// 14. طباعة تذكرة المطبخ/البار
// ══════════════════════════════════════════════════════════════
/**
 * @param {Object} order
 * @param {string} station - "bar" | "kitchen" | "hookah"
 * @param {Object} settings
 */
export const printKitchenTicket = (order, station = "bar", settings) => {
  const stationLabel = station === "bar" ? "🍹 البار" :
    station === "hookah" ? "💨 الأراكيل" : "🍳 المطبخ";

  // فلترة الأصناف حسب الفرع
  const catMap = {
    bar:     ["hot_drinks", "cold_drinks", "food"],
    hookah:  ["hookah"],
    kitchen: ["food"],
  };
  const cats = catMap[station] || catMap.bar;
  const items = (order.items || []).filter(it => cats.includes(it.category));
  if (!items.length) return; // لا يوجد شيء لهذا الفرع

  const now = new Date();
  const timeStr = now.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });
  const itemsHTML = items.map(it =>
    `<tr>
      <td style="padding:8px;font-size:20px;border-bottom:1px dashed #ccc">${it.emoji || ""} ${it.itemName}</td>
      <td style="padding:8px;font-size:28px;font-weight:900;text-align:center;border-bottom:1px dashed #ccc;color:#c62828">×${it.qty}</td>
    </tr>`
  ).join("");

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;direction:rtl;max-width:300px;margin:0 auto;padding:12px}
  h1{text-align:center;font-size:22px;margin-bottom:4px}
  .meta{text-align:center;font-size:14px;color:#555;margin-bottom:12px;border-bottom:2px solid #000;padding-bottom:8px}
  table{width:100%;border-collapse:collapse}
  .footer{text-align:center;margin-top:12px;font-size:12px;color:#888;border-top:1px dashed #ccc;padding-top:8px}
  @media print{body{max-width:none}}
</style>
</head>
<body>
  <h1>${stationLabel}</h1>
  <div class="meta">
    <strong>طلب #${order.orderNum || order.id}</strong><br>
    ${order.table ? `🪑 ${order.table}` : ""}
    ${order.customerName ? ` — ${order.customerName}` : ""}<br>
    ⏰ ${timeStr}
  </div>
  <table>${itemsHTML}</table>
  ${order.notes ? `<div style="margin-top:12px;padding:8px;background:#fff9e6;border-radius:6px;font-size:13px">📝 ${order.notes}</div>` : ""}
  <div class="footer">${settings?.cafeName || "Nardeen Caffe"}</div>
  <script>window.addEventListener('load',()=>{window.print();setTimeout(()=>window.close(),1500);});</script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "width=350,height=500");
  if (win) win.onafterprint = () => URL.revokeObjectURL(url);
};

// ══════════════════════════════════════════════════════════════
// 10. نظام الولاء
// ══════════════════════════════════════════════════════════════
/**
 * يُعيد حالة الولاء للزبون
 * @param {Object} customer
 * @param {Object} settings
 * @returns {Object} { eligible, nextReward, progress, discountPercent }
 */
export const getLoyaltyStatus = (customer, settings) => {
  const threshold = settings?.loyaltyVisitsForReward || 10;
  const discountPercent = settings?.loyaltyDiscountPercent || 10;
  const visits = customer?.visits || 0;
  const eligible = visits > 0 && visits % threshold === 0;
  const progress = visits % threshold;
  const nextReward = threshold - progress;
  return { eligible, nextReward, progress, threshold, discountPercent };
};

/**
 * يحسب الخصم المستحق بناءً على نظام الولاء
 */
export const calcLoyaltyDiscount = (total, customer, settings) => {
  const { eligible, discountPercent } = getLoyaltyStatus(customer, settings);
  if (!eligible) return 0;
  return Math.round(total * (discountPercent / 100));
};

// ══════════════════════════════════════════════════════════════
// 6. دفع جزئي — حساب المبلغ المتبقي
// ══════════════════════════════════════════════════════════════
/**
 * @param {Object} order
 * @returns {Object} { remaining, partialPaid, isPaid }
 */
export const getPartialPaymentStatus = (order) => {
  const total = order.total || 0;
  const partialPaid = order.partialPaid || 0;
  const remaining = Math.max(0, total - partialPaid);
  const isPaid = remaining === 0;
  return { remaining, partialPaid, isPaid, total };
};

// ══════════════════════════════════════════════════════════════
// 9. تقرير الموظف الأفضل
// ══════════════════════════════════════════════════════════════
/**
 * @param {Array} orders - الطلبات المدفوعة
 * @param {Array} users
 * @returns {Array} ترتيب الموظفين
 */
export const getStaffReport = (orders, users) => {
  const paidOrders = orders.filter(o => o.status === "paid" && o.paidByName);
  const map = {};
  paidOrders.forEach(o => {
    const name = o.paidByName || o.workerName || "غير محدد";
    if (!map[name]) map[name] = { name, orders: 0, revenue: 0 };
    map[name].orders++;
    map[name].revenue += o.total || 0;
  });
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
};

// ══════════════════════════════════════════════════════════════
// 8. خريطة ساعات الذروة
// ══════════════════════════════════════════════════════════════
/**
 * يُعيد عدد الطلبات لكل ساعة (0-23)
 * @param {Array} orders
 * @returns {Array<{hour, count, revenue}>}
 */
export const getPeakHoursData = (orders) => {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, revenue: 0 }));
  orders.forEach(o => {
    if (!o.createdAt) return;
    const h = new Date(o.createdAt).getHours();
    hours[h].count++;
    hours[h].revenue += o.total || 0;
  });
  return hours;
};

// ══════════════════════════════════════════════════════════════
// 7. مقارنة المبيعات
// ══════════════════════════════════════════════════════════════
/**
 * يُعيد ملخص مبيعات فترة ومقارنتها بالفترة السابقة
 * @param {Array} orders
 * @param {Date} from
 * @param {Date} to
 * @returns {Object}
 */
export const getSalesComparison = (orders, from, to) => {
  const diffMs = to - from;
  const prevFrom = new Date(from.getTime() - diffMs);
  const prevTo = new Date(from);

  const current = orders.filter(o => {
    const d = new Date(o.createdAt || o.created_at);
    return d >= from && d <= to && o.status === "paid";
  });
  const previous = orders.filter(o => {
    const d = new Date(o.createdAt || o.created_at);
    return d >= prevFrom && d <= prevTo && o.status === "paid";
  });

  const sum = arr => arr.reduce((a, o) => a + (o.total || 0), 0);
  const currRevenue = sum(current);
  const prevRevenue = sum(previous);
  const change = prevRevenue > 0
    ? Math.round(((currRevenue - prevRevenue) / prevRevenue) * 100)
    : (currRevenue > 0 ? 100 : 0);

  return {
    current: { orders: current.length, revenue: currRevenue },
    previous: { orders: previous.length, revenue: prevRevenue },
    change, // نسبة التغيير المئوية
    isUp: currRevenue >= prevRevenue,
  };
};

// ══════════════════════════════════════════════════════════════
// Excel تصدير
// ══════════════════════════════════════════════════════════════
export const exportToExcel = (orders, menu) => {
  const rows = [
    ["رقم الطلب", "الزبون", "الطاولة", "المجموع", "الحالة", "نوع الدفع", "التاريخ", "الموظف"],
    ...orders.map(o => [
      o.orderNum || o.id,
      o.customerName || "",
      o.table || "",
      o.total || 0,
      o.status || "",
      o.paymentType || "",
      o.createdAt ? new Date(o.createdAt).toLocaleDateString("ar-SY") : "",
      o.paidByName || o.workerName || "",
    ])
  ];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `nardeen_orders_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ══════════════════════════════════════════════════════════════
// QR الطاولة
// ══════════════════════════════════════════════════════════════
export const generateTableQR = async (tableNum, baseUrl) => {
  const url = baseUrl || `${window.location.origin}?table=${tableNum}`;
  // استخدام QR code API مجاني بدون مكتبة
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
};

// ══════════════════════════════════════════════════════════════
// طباعة الطلب (الكاشير)
// ══════════════════════════════════════════════════════════════
export const printOrder = (order, menu, copy = 1, settings) => {
  const CUR = settings?.currency || "ل.س";
  const cafeName = settings?.cafeName || "Nardeen Caffe";
  const copyLabel = copy === 2 ? " (نسخة البار)" : "";
  const now = new Date();
  const dateStr = now.toLocaleDateString("ar-SY");
  const timeStr = now.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });

  const itemsHTML = (order.items || [])
    .map(it => `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #eee">${it.emoji || ""} ${it.itemName}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">×${it.qty}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:left;font-weight:700">${(it.price * it.qty).toLocaleString()} ${CUR}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;direction:rtl;color:#1a1a2e;max-width:380px;margin:0 auto;padding:20px}
  h1{text-align:center;color:#c62828;font-size:20px;margin-bottom:4px}
  .meta{font-size:12px;color:#555;margin-bottom:10px;border-bottom:1px dashed #ccc;padding-bottom:8px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  .total{font-size:16px;font-weight:900;color:#c62828;text-align:left;margin-top:8px}
  @media print{body{max-width:none}}
</style>
</head>
<body>
  <h1>☕ ${cafeName}${copyLabel}</h1>
  <div class="meta">
    طلب #${order.orderNum || order.id} | ${dateStr} ${timeStr}<br>
    ${order.table ? `طاولة: ${order.table}` : ""}
    ${order.customerName ? ` | ${order.customerName}` : ""}
  </div>
  <table>${itemsHTML}</table>
  <p class="total">الإجمالي: ${(order.total || 0).toLocaleString()} ${CUR}</p>
  ${order.notes ? `<p style="margin-top:8px;font-size:12px;color:#795548">📝 ${order.notes}</p>` : ""}
  <script>window.addEventListener('load',()=>{window.print();setTimeout(()=>window.close(),1500);});</script>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "width=450,height=600");
  if (win) win.onafterprint = () => URL.revokeObjectURL(url);
};

// ══════════════════════════════════════════════════════════════
// v36 — فصل الترون: مصدر واحد للحقيقة
// ══════════════════════════════════════════════════════════════
// الترون يُعامَل معاملة الضيافة والديون: بند منفصل تماماً لا يدخل
// النقد الفعلي ولا الإيرادات ولا المبيعات ولا الربح الصافي.
//  - orderTron: حصّة الترون من الطلب (مخزّنة على الطلب عند الدفع).
//  - orderCash: الجزء النقدي/البطاقة الفعلي = الإجمالي − الترون.
//  - orderCashFrac: نسبة الجزء النقدي (لتوزيع التكلفة بدقّة).
//  - orderCogs: تكلفة البضاعة المباعة للطلب (تستثني الأصناف المُقدّمة ضيافةً).
export const orderTron = (o) => Math.max(0, +(o?.tronAmount) || 0);
// v40: الترون إكرامية «فوق الفاتورة» — نقده موجود في الصندوق ويُتتبَّع كبند منفصل.
// `total` يمثّل ثمن البضاعة فقط ولا يشمل الترون، لذا لا يُطرح منه هنا (كان يُطرح مرتين).
export const orderCash = (o) => Math.max(0, +(o?.total) || 0);        // نقد البضاعة (الترون منفصل، يُضاف للمتوقع)
export const orderCashFrac = (o) => 1; // البضاعة كاملة؛ الترون لا ينقص حصّة التكلفة
// v39: قيمة البيع الكاملة (تشمل الترون) — للمبيعات/الإيراد/الربح. الترون يُستبعَد من نقد الدرج فقط.
export const orderSale = (o) => Math.max(0, +(o?.total) || 0);
// ══════════════════════════════════════════════════════════════
// v40 — تسعير حيّ: المنيو هو مصدر السعر الوحيد
// ══════════════════════════════════════════════════════════════
// السعر لم يَعُد لقطة مجمّدة على سطر الطلب. عند الفوترة/التعديل يُقرأ السعر
// الحالي من المنيو. الأصناف اليدوية (خاص/جلسة/سطر فريد/سداد دين) تحتفظ
// بسعرها المُدخَل يدوياً لأنها ليست في المنيو.
export const isManualPriceLine = (line) =>
  !!(line?.special || line?.lineId || line?.itemId === "debt" || line?.isSession || line?.isCustom);

export const livePrice = (line, menu, branch = "main") => {
  if (isManualPriceLine(line)) return Math.max(0, +line?.price || 0);
  const m = (menu || []).find((x) => x.id === line?.itemId);
  if (!m) return Math.max(0, +line?.price || 0); // صنف محذوف من المنيو → أبقِ اللقطة
  const p = branch === "outdoor" ? (m.outdoorPrice ?? m.price) : m.price;
  return Math.max(0, p != null ? +p : (+line?.price || 0));
};

// يعيد نسخة الطلب بأسعار حيّة من المنيو + إجمالي مُعاد الحساب.
export const refreshOrderPricing = (order, menu) => {
  const branch = order?.branch || "main";
  const items = (order?.items || []).map((i) => ({ ...i, price: livePrice(i, menu, branch) }));
  const total = items.reduce((s, i) => s + (+i.price || 0) * (+i.qty || 0), 0);
  return { items, total };
};

export const orderCogs = (o, menu) => {
  const costOf = (id) => { const m = (menu || []).find(x => x.id === id); return m && m.cost != null ? +m.cost : 0; };
  return (o?.items || []).reduce((s, i) => {
    const qty = +i.qty || 0;
    const freeQty = i.complimentary ? qty : (+i.compQty || 0); // الضيافة لا تُحتسب تكلفةً
    return s + costOf(i.itemId) * Math.max(0, qty - freeQty);
  }, 0);
};

// ══════════════════════════════════════════════════════════════
// v7 — أدوات تقفيل الوردية (8)
// ══════════════════════════════════════════════════════════════
/**
 * يحسب ملخص الوردية من الطلبات والمصاريف ضمن نطاق زمني
 * @param {Array} orders - كل الطلبات
 * @param {Array} expenses - كل المصاريف
 * @param {string} shiftId - معرف الوردية (للفلترة الدقيقة)
 * @param {Date} openedAt - وقت فتح الوردية
 * @param {string} branch - الفرع
 */
export const calcShiftSummary = (orders, expenses, shiftId, openedAt, branch = "main", closedAt = null) => {
  const from = openedAt ? new Date(openedAt).getTime() : 0;
  const to = closedAt ? new Date(closedAt).getTime() : Infinity; // وردية مفتوحة = حتى الآن
  // v4.7.0: المطابقة بالمعرّف أولًا. الطلبات القديمة بلا shiftId تُطابَق زمنيًا
  // ضمن نطاق الوردية [البدء..الإغلاق] فقط — فلا تُسحَب طلبات وردية أخرى ولا تُفقد.
  const inWindow = (iso) => { const t = iso ? new Date(iso).getTime() : NaN; return t >= from && t <= to; };
  const belongs = (o) => {
    if ((o.branch || "main") !== branch) return false;
    if (shiftId && o.shiftId) return o.shiftId === shiftId;
    return inWindow(o.paidAt || o.createdAt);
  };
  const shiftOrders = orders.filter(belongs);

  // v37: الضيافة معزولة كليًا — تُستبعَد صراحةً من المبيعات/النقد (لها جردها الخاص في compTotal)
  const paid = shiftOrders.filter(o => o.status === "paid" && !o.isComplimentary);
  // v36: الترون مستبعَد من النقد الفعلي ومن المبيعات — يُطرح من كل طلب (orderCash)
  const cashSales = paid.filter(o => o.paymentType === "cash").reduce((s, o) => s + orderCash(o), 0);
  const cardSales = paid.filter(o => o.paymentType === "card").reduce((s, o) => s + orderCash(o), 0);
  // v31.6: نقد سداد الديون يدخل الصندوق فعلياً — يُحتسب في المتوقع
  const debtSettledCash = paid.filter(o => o.paymentType === "debt_settled").reduce((s, o) => s + (o.total || 0), 0);
  const tronSales = paid.reduce((s, o) => s + orderTron(o), 0); // v36: بند الترون المنفصل
  const debtTotal = shiftOrders.filter(o => o.status === "debt").reduce((s, o) => s + (o.total || 0), 0);
  const compTotal = shiftOrders.reduce((s, o) => s + (o.compAmount || 0), 0);
  const totalSales = paid.reduce((s, o) => s + orderSale(o), 0); // v39: المبيعات الكاملة (تشمل الترون)

  // v40: نفصل المصاريف اليومية (تمسّ الصندوق) عن الثانوية (بند منفصل لا يمسّ الصندوق)
  const inShiftWindow = (e) => {
    if ((e.branch || "main") !== branch) return false;
    if (shiftId && e.shiftId) return e.shiftId === shiftId;
    return inWindow(e.date);
  };
  const shiftExpenses = (expenses || []).filter(e => {
    // v30.1: المصاريف الثانوية لا تدخل حساب الوردية إطلاقاً (لا تمسّ الصندوق)
    if (e.isSecondary) return false;
    return inShiftWindow(e);
  }).reduce((s, e) => s + (e.amount || 0), 0);
  const secExpensesTotal = (expenses || []).filter(e => e.isSecondary && inShiftWindow(e))
    .reduce((s, e) => s + (e.amount || 0), 0); // v40: بند منفصل للعرض فقط

  return {
    cashSales, cardSales, tronSales, debtTotal, compTotal, totalSales, debtSettledCash,
    ordersCount: paid.length,
    expensesTotal: shiftExpenses,
    secExpensesTotal, // v40
  };
};

// ══════════════════════════════════════════════════════════════
// v7 — أدوات KDS (1) — حساب لون/حالة الطلب حسب وقت الانتظار
// ══════════════════════════════════════════════════════════════
/**
 * يُرجع حالة الطلب البصرية حسب دقائق الانتظار
 * @param {string} createdAt
 * @returns {{minutes, level, color, label}}
 */
export const getOrderUrgency = (createdAt, thresholds = { warn: 5, danger: 10 }) => {
  const mins = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000) : 0;
  let level = "normal", color = "#2e7d32", label = "جديد";
  if (mins >= thresholds.danger) { level = "danger"; color = "#c62828"; label = "متأخر جداً"; }
  else if (mins >= thresholds.warn) { level = "warn"; color = "#e65100"; label = "تأخير"; }
  return { minutes: mins, level, color, label };
};

/**
 * متوسط وقت التحضير للطلبات المكتملة (بالدقائق)
 */
export const getAvgPrepTime = (orders) => {
  const completed = orders.filter(o => o.readyAt && o.createdAt);
  if (!completed.length) return 0;
  const total = completed.reduce((s, o) =>
    s + (new Date(o.readyAt).getTime() - new Date(o.createdAt).getTime()) / 60000, 0);
  return Math.round(total / completed.length);
};

// ══════════════════════════════════════════════════════════════
// v7 — محفظة الولاء (6)
// ══════════════════════════════════════════════════════════════
/**
 * يحسب النقاط المكتسبة من مبلغ الطلب
 * @param {number} total
 * @param {Object} settings
 */
export const calcEarnedPoints = (total, settings) => {
  const rate = settings?.loyaltyEarnRate ?? 0.05; // 5% افتراضي
  return Math.floor((total || 0) * rate);
};

/**
 * طبقة العضوية حسب إجمالي الإنفاق
 */
export const getCustomerTier = (totalSpent, settings) => {
  const t = totalSpent || 0;
  const tiers = settings?.loyaltyTiers || { silver: 50000, gold: 200000, vip: 500000 };
  if (t >= tiers.vip)    return { key: "vip",    label: "💎 VIP",    color: "#6a1b9a", mult: 2 };
  if (t >= tiers.gold)   return { key: "gold",   label: "🥇 ذهبي",   color: "#f9a825", mult: 1.5 };
  if (t >= tiers.silver) return { key: "silver", label: "🥈 فضي",    color: "#90a4ae", mult: 1.2 };
  return { key: "bronze", label: "🥉 برونزي", color: "#8d6e63", mult: 1 };
};

/**
 * قيمة النقاط القابلة للاستبدال (نقطة = كم وحدة عملة)
 */
export const pointsToValue = (points, settings) => {
  const ratio = settings?.loyaltyPointValue ?? 1; // 1 نقطة = 1 وحدة
  return Math.floor((points || 0) * ratio);
};

// ── صافي الربح = البيع الكامل (بعد الخصومات، يشمل الترون) − تكلفة البضاعة المباعة ──
// v39: الترون بيعٌ حقيقي يدخل الإيراد والربح؛ يُستبعَد من نقد الدرج فقط.
export const calcNetProfit = (orders, menu, since = null) => {
  let profit = 0;
  (orders || []).filter(o => o.status === "paid" && !o.isComplimentary).forEach(o => {
    if (since && new Date(o.paidAt || o.createdAt) < since) return;
    profit += orderSale(o) - orderCogs(o, menu);
  });
  return profit;
};
