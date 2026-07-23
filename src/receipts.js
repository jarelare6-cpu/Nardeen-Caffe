// أدوات الفواتير والطباعة — مفصولة من App.jsx
import { printOrder as utilPrint, exportToExcel, generateTableQR, sendReceiptWhatsApp, printKitchenTicket, orderCash, orderTron, workDayStart } from "./lib/utils.js";
import { SUPABASE_READY, sbDeleteAll, sbDelete, sbUpsert, sbFetch } from "./lib/supabase.js";
import { ROLES, ROLE_LABELS, ROLE_COLORS, ORDER_STATUS, STATUS_LABELS, STATUS_COLORS, CAT_LABELS, CAT_ORDER, BAR_CATS, HOOKAH_CATS, STATION_CATS, PERMISSIONS, THEMES, catOf, orderFullyPrepared, canAccess } from "./constants.js";

export const printOrder = (order, menu, copy, settings) => utilPrint(order, menu, copy, settings);

// حفظ سجل الفاتورة في Supabase
// ══════════════════════════════════════════════════════════════
// PDF الفاتورة + حفظ السجل
// ══════════════════════════════════════════════════════════════

export const generateReceiptPDF = async (order, settings, tronAmount = 0) => {
  const CUR = settings?.currency || "ل.س";
  const cafeName = settings?.cafeName || "Nardeen Caffe";
  const signature = settings?.signature || "";
  const cashierName = order.paidByName || "";       // من حاسب (الكاشير)
  const workerName  = order.workerName || "";        // من أخذ الطلب (العامل)
  const now = new Date();
  const dateStr = now.toLocaleDateString("ar-SY");
  const timeStr = now.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });
  const itemsHTML = (order.items || []).map(it =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${it.emoji || ""} ${it.itemName}${it.note ? `<br><span style="font-size:11px;color:#c62828">📝 ${it.note}</span>` : ""}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">×${it.qty}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:left;font-weight:700;color:#c62828">${(it.price * it.qty).toLocaleString()} ${CUR}</td></tr>`
  ).join("");
  const payLabel = order.paymentType === "cash" ? "💵 نقدي" : order.paymentType === "card" ? "💳 بطاقة" : order.paymentType === "tron" ? "💠 ترون" : order.paymentType === "debt" ? "📋 دين" : order.paymentType || "نقدي";
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>فاتورة #${order.orderNum||order.id}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;direction:rtl;color:#1a1a2e;background:#fff}.wrapper{max-width:380px;margin:0 auto;padding:24px 20px}.header{text-align:center;background:linear-gradient(135deg,#8e0000,#c62828);color:#fff;border-radius:12px;padding:18px 12px;margin-bottom:16px}.header h1{font-size:22px;color:#fff;margin-bottom:4px}.header p{font-size:12px;color:rgba(255,255,255,.85)}.meta{display:flex;justify-content:space-between;margin-bottom:12px;font-size:12px;color:#444}table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px}.totals{background:#f9f9f9;border-radius:8px;padding:12px;margin-bottom:12px}.totals div{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}.totals .grand{font-size:16px;font-weight:900;color:#c62828;border-top:2px solid #c62828;padding-top:8px;margin-top:4px}.tron{background:#e8f5e9;border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;color:#2e7d32;font-weight:700;text-align:center}.footer{text-align:center;border-top:1px dashed #ccc;padding-top:12px;font-size:11px;color:#888}@media print{body{background:white}}</style></head><body><div class="wrapper"><div class="header"><h1>☕ ${cafeName}</h1><p>${signature}</p></div><div class="meta"><span><strong>رقم الفاتورة:</strong> #${order.orderNum||order.id}</span><span>${dateStr} ${timeStr}</span></div>${order.table?`<div class="meta"><span><strong>الطاولة:</strong> ${order.table}</span><span><strong>الزبون:</strong> ${order.customerName||"زبون"}</span></div>`:""}<table><thead><tr style="background:#f0f0f0"><th style="padding:6px 8px;text-align:right">الصنف</th><th style="padding:6px 8px;text-align:center">الكمية</th><th style="padding:6px 8px;text-align:left">السعر</th></tr></thead><tbody>${itemsHTML}</tbody></table><div class="totals">${(order.discount||0)>0?`<div><span>قبل الخصم</span><span>${(order.originalTotal||order.total).toLocaleString()} ${CUR}</span></div><div style="color:#2e7d32"><span>خصم ${order.discount}%</span><span>-${((order.originalTotal||0)-order.total).toLocaleString()} ${CUR}</span></div>`:""}<div class="grand"><span>الإجمالي</span><span>${(order.total||0).toLocaleString()} ${CUR}</span></div>${tronAmount>0?`<div style="color:#1565c0;margin-top:4px"><span>💠 الترون</span><span>${tronAmount.toLocaleString()} ${CUR}</span></div>`:""}<div style="margin-top:6px;font-size:12px"><span>طريقة الدفع</span><span>${payLabel}</span></div></div>${tronAmount>0?`<div class="tron">💠 مبلغ الترون: ${tronAmount.toLocaleString()} ${CUR}</div>`:""}</div>${order.notes?`<div style="background:#fff9e6;border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;color:#795548">📝 ${order.notes}</div>`:""}<div class="footer"><p>شكراً لزيارتكم ☕</p>${(workerName||cashierName)?`<div style="margin-top:6px;display:flex;justify-content:space-between;font-size:11px;font-weight:700;border-top:1px solid #eee;padding-top:6px">${workerName?`<span>📝 الطلب: ${workerName}</span>`:"<span></span>"}${cashierName?`<span>💰 المحاسبة: ${cashierName}</span>`:"<span></span>"}</div>`:""}<p style="margin-top:6px">${cafeName} — ${signature}</p></div></div></div><script>window.addEventListener('load',()=>{window.print();});</script></body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "width=450,height=700");
  if (win) { win.onafterprint = () => URL.revokeObjectURL(url); }
  else { const a = document.createElement("a"); a.href = url; a.download = `فاتورة_${order.orderNum||order.id}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return url;
};


export const saveReceiptRecord = (order, settings, store, tronAmount = 0) => {
  const receipt = {
    id: "rcpt_" + order.id, // v33: حتمي => دفع/فاتورة مزدوجة لا تتكرر
    orderId: order.id, orderNum: order.orderNum || order.order_num || "",
    customerName: order.customerName || order.customer_name || "",
    tableNum: String(order.table || order.table_num || ""),
    items: order.items || [], total: order.total || 0, discount: order.discount || 0,
    paymentType: tronAmount > 0 ? "tron" : (order.paymentType || "cash"),
    notes: order.notes || "", createdBy: order.paidByName || order.workerName || "",
    createdAt: new Date().toISOString(), cafeName: settings?.cafeName || "Nardeen Caffe", tronAmount,
  };
  store.setReceipts(p => [receipt, ...p]);
  return receipt;
};

// backward compat

export const saveReceipt = (order, settings, store) => { if (store) saveReceiptRecord(order, settings, store, 0); };

// ═══════════════════════════════════
// GLOBAL CSS
// ═══════════════════════════════════


// ══════════════════════════════════════════════════════════════
// v23: تقرير الإقفال اليومي (Z-Report) — PDF قابل للطباعة
// ══════════════════════════════════════════════════════════════
export const generateZReportPDF = (store, settings, user) => {
  const CUR = settings?.currency || "ل.س";
  const cafeName = settings?.cafeName || "Nardeen Caffe";
  const now = new Date();
  // v40: حدّ «اليوم» = يوم العمل (افتتاح الوردية/قطع 1ص) بدل منتصف الليل — ليطابق إغلاق الوردية واللوحات
  const dayStart = workDayStart(store.shifts);
  const inToday = (iso) => iso && new Date(iso) >= dayStart;

  const orders = store.orders || [];
  const paidToday = orders.filter(o => o.status === "paid" && inToday(o.paidAt || o.createdAt));
  const fullPaid = paidToday.filter(o => o.paymentStatus !== "partial");
  const partials = paidToday.filter(o => o.paymentStatus === "partial");
  const sum = (arr, f = (o) => o.total || 0) => arr.reduce((s, o) => s + f(o), 0);

  const cashSales = sum(fullPaid.filter(o => o.paymentType === "cash"), orderCash); // v36: بلا ترون
  const cardSales = sum(fullPaid.filter(o => o.paymentType === "card"), orderCash); // v36: بلا ترون
  const tronSales = sum(paidToday, orderTron); // v36: بند الترون الموحّد (من الطلبات)
  const partialPaidAmt = sum(partials, o => o.partialPaid || o.total || 0);
  const revenue = sum(paidToday, orderCash); // v36: إيراد نقدي بلا ترون

  const debtsToday = (store.debts || []).filter(d => inToday(d.date));
  const debtsNew = sum(debtsToday, d => d.amount || 0);
  const compToday = sum((store.compLog || []).filter(c => inToday(c.createdAt)), c => c.amount || 0);
  const expToday = sum((store.expenses || []).filter(e => !e.isSecondary && !e.isComplimentary && inToday(e.date)), e => e.amount || 0);
  const secExpToday = sum((store.expenses || []).filter(e => e.isSecondary && inToday(e.date)), e => e.amount || 0); // v40: بند منفصل
  const debtSettledCash = sum((store.cashLog || []).filter(c => ["debt_payment", "debt_settle"].includes(c.type) && inToday(c.at)), c => c.amount || 0);
  // v36: صافي الصندوق = الإيراد النقدي − المصاريف (الترون مستبعَد، يُعرض منفصلاً)
  const netBox = revenue - expToday;

  // أعلى 5 أصناف مبيعاً اليوم
  const itemCount = {};
  paidToday.forEach(o => (o.items || []).forEach(it => {
    itemCount[it.itemName] = (itemCount[it.itemName] || 0) + it.qty;
  }));
  const topItems = Object.entries(itemCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const branches = {};
  paidToday.forEach(o => { const b = o.branch || "main"; branches[b] = (branches[b] || 0) + orderCash(o); }); // v36: بلا ترون

  const row = (l, v, opts = "") => `<div class="r ${opts}"><span>${l}</span><span>${typeof v === "number" ? v.toLocaleString() + " " + CUR : v}</span></div>`;
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير إقفال — ${now.toLocaleDateString("ar-SY")}</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;direction:rtl;color:#1a1a2e;background:#fff}
.w{max-width:420px;margin:0 auto;padding:24px 20px}
.h{text-align:center;background:linear-gradient(135deg,#1a237e,#3949ab);color:#fff;border-radius:12px;padding:18px 12px;margin-bottom:16px}
.h h1{font-size:20px;margin-bottom:4px}.h p{font-size:12px;opacity:.85}
.sec{background:#f8f9fb;border-radius:10px;padding:12px 14px;margin-bottom:12px}
.sec h3{font-size:13px;color:#3949ab;margin-bottom:8px;border-bottom:1px solid #e0e0e8;padding-bottom:6px}
.r{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}
.r.bold{font-weight:900;font-size:14px;border-top:1.5px solid #3949ab;margin-top:4px;padding-top:8px;color:#1a237e}
.r.red span:last-child{color:#c62828}.r.green span:last-child{color:#2e7d32}
.foot{text-align:center;border-top:1px dashed #ccc;padding-top:12px;font-size:11px;color:#888}
@media print{body{background:white}}
</style></head><body><div class="w">
<div class="h"><h1>🧾 تقرير الإقفال اليومي</h1><p>${cafeName} — ${now.toLocaleDateString("ar-SY")} ${now.toLocaleTimeString("ar-SY",{hour:"2-digit",minute:"2-digit"})}</p></div>
<div class="sec"><h3>💰 المبيعات (${paidToday.length} طلب مدفوع)</h3>
${row("💵 نقدي", cashSales)}${row("💳 بطاقة", cardSales)}${row("💠 ترون", tronSales)}
${partials.length ? row(`⏳ دفعات جزئية (${partials.length})`, partialPaidAmt) : ""}
${row("إجمالي المبيعات", revenue, "bold")}</div>
${Object.keys(branches).length > 1 ? `<div class="sec"><h3>🏪 حسب الفرع</h3>${Object.entries(branches).map(([b, v]) => row(b === "outdoor" ? "🌳 الحديقة" : "☕ الرئيسي", v)).join("")}</div>` : ""}
<div class="sec"><h3>📒 حركات أخرى</h3>
${row(`💳 ديون جديدة (${debtsToday.length})`, debtsNew, "red")}
${debtSettledCash ? row("✅ تحصيل ديون", debtSettledCash, "green") : ""}
${row("🎁 ضيافة", compToday)}
${row("📤 مصاريف", expToday, "red")}
${secExpToday ? row("⭐ مصاريف ثانوية (منفصلة)", secExpToday) : ""}</div>
<div class="sec"><h3>🏆 الأكثر مبيعاً اليوم</h3>
${topItems.length ? topItems.map(([n, q]) => row(n, "×" + q)).join("") : '<div class="r"><span>—</span><span></span></div>'}</div>
<div class="sec">${row("📦 صافي الصندوق (جرد اليوم)", netBox, "bold")}
<div style="font-size:10.5px;color:#888;margin-top:4px">= الإيراد النقدي − المصاريف (الترون منفصل تماماً)</div></div>
<div class="foot"><p>أصدره: ${user?.name || "—"}</p><p style="margin-top:4px">${cafeName}</p></div>
</div><script>window.addEventListener('load',()=>{window.print();});</script></body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "width=470,height=750");
  if (win) { win.onafterprint = () => URL.revokeObjectURL(url); }
  else { const a = document.createElement("a"); a.href = url; a.download = `تقرير_اقفال_${now.toISOString().slice(0,10)}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
};
