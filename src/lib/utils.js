// src/lib/utils.js — Nardeen Caffe v6.0
// ══════════════════════════════════════════════════════════════
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

// ── صوت التنبيه ───────────────────────────────────────────────
export const playOrderAlert = (tone = "bell") => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (tone === "bell") {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    } else if (tone === "chime") {
      osc.frequency.setValueAtTime(1046, ctx.currentTime);
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.15);
    } else if (tone === "ping") {
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
    } else {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
    }
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
  } catch {}
};

// ══════════════════════════════════════════════════════════════
// 5. تنبيه نفاد المخزون
// ══════════════════════════════════════════════════════════════
/**
 * يُعيد قائمة الأصناف التي وصلت لـ minStock أو أقل
 * @param {Array} menu
 * @returns {Array} lowItems
 */
export const checkStockAlerts = (menu) => {
  return menu.filter(m => m.active && m.stock <= (m.minStock || 5));
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
export const calcShiftSummary = (orders, expenses, shiftId, openedAt, branch = "main") => {
  const from = openedAt ? new Date(openedAt) : new Date(0);
  // طلبات الوردية: إما بنفس shiftId أو ضمن النطاق الزمني وبنفس الفرع
  const shiftOrders = orders.filter(o => {
    const matchBranch = (o.branch || "main") === branch;
    if (!matchBranch) return false;
    if (shiftId && o.shiftId) return o.shiftId === shiftId;
    const paidTime = o.paidAt ? new Date(o.paidAt) : null;
    return paidTime && paidTime >= from;
  });

  const paid = shiftOrders.filter(o => o.status === "paid");
  const cashSales = paid.filter(o => o.paymentType === "cash").reduce((s, o) => s + (o.total || 0), 0);
  const cardSales = paid.filter(o => o.paymentType === "card").reduce((s, o) => s + (o.total || 0), 0);
  const tronSales = paid.reduce((s, o) => s + (o.tronAmount || 0), 0);
  const debtTotal = shiftOrders.filter(o => o.status === "debt").reduce((s, o) => s + (o.total || 0), 0);
  const compTotal = shiftOrders.reduce((s, o) => s + (o.compAmount || 0), 0);
  const totalSales = paid.reduce((s, o) => s + (o.total || 0), 0);

  const shiftExpenses = (expenses || []).filter(e => {
    const eTime = new Date(e.date);
    const matchBranch = (e.branch || "main") === branch;
    return matchBranch && eTime >= from;
  }).reduce((s, e) => s + (e.amount || 0), 0);

  return {
    cashSales, cardSales, tronSales, debtTotal, compTotal, totalSales,
    ordersCount: paid.length,
    expensesTotal: shiftExpenses,
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
