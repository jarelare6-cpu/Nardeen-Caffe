// أدوات الفواتير والطباعة — مفصولة من App.jsx
import { printOrder as utilPrint, exportToExcel, generateTableQR, sendReceiptWhatsApp, printKitchenTicket } from "./lib/utils.js";
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
  const staffName = order.paidByName || order.workerName || "";
  const now = new Date();
  const dateStr = now.toLocaleDateString("ar-SY");
  const timeStr = now.toLocaleTimeString("ar-SY", { hour: "2-digit", minute: "2-digit" });
  const itemsHTML = (order.items || []).map(it =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${it.emoji || ""} ${it.itemName}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center">×${it.qty}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:left;font-weight:700;color:#c62828">${(it.price * it.qty).toLocaleString()} ${CUR}</td></tr>`
  ).join("");
  const payLabel = order.paymentType === "cash" ? "💵 نقدي" : order.paymentType === "card" ? "💳 بطاقة" : order.paymentType === "tron" ? "💠 ترون" : order.paymentType === "debt" ? "📋 دين" : order.paymentType || "نقدي";
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>فاتورة #${order.orderNum||order.id}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;direction:rtl;color:#1a1a2e;background:#fff}.wrapper{max-width:380px;margin:0 auto;padding:24px 20px}.header{text-align:center;background:linear-gradient(135deg,#8e0000,#c62828);color:#fff;border-radius:12px;padding:18px 12px;margin-bottom:16px}.header h1{font-size:22px;color:#fff;margin-bottom:4px}.header p{font-size:12px;color:rgba(255,255,255,.85)}.meta{display:flex;justify-content:space-between;margin-bottom:12px;font-size:12px;color:#444}table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px}.totals{background:#f9f9f9;border-radius:8px;padding:12px;margin-bottom:12px}.totals div{display:flex;justify-content:space-between;padding:4px 0;font-size:13px}.totals .grand{font-size:16px;font-weight:900;color:#c62828;border-top:2px solid #c62828;padding-top:8px;margin-top:4px}.tron{background:#e8f5e9;border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;color:#2e7d32;font-weight:700;text-align:center}.footer{text-align:center;border-top:1px dashed #ccc;padding-top:12px;font-size:11px;color:#888}@media print{body{background:white}}</style></head><body><div class="wrapper"><div class="header"><h1>☕ ${cafeName}</h1><p>${signature}</p></div><div class="meta"><span><strong>رقم الفاتورة:</strong> #${order.orderNum||order.id}</span><span>${dateStr} ${timeStr}</span></div>${order.table?`<div class="meta"><span><strong>الطاولة:</strong> ${order.table}</span><span><strong>الزبون:</strong> ${order.customerName||"زبون"}</span></div>`:""}<table><thead><tr style="background:#f0f0f0"><th style="padding:6px 8px;text-align:right">الصنف</th><th style="padding:6px 8px;text-align:center">الكمية</th><th style="padding:6px 8px;text-align:left">السعر</th></tr></thead><tbody>${itemsHTML}</tbody></table><div class="totals">${(order.discount||0)>0?`<div><span>قبل الخصم</span><span>${(order.originalTotal||order.total).toLocaleString()} ${CUR}</span></div><div style="color:#2e7d32"><span>خصم ${order.discount}%</span><span>-${((order.originalTotal||0)-order.total).toLocaleString()} ${CUR}</span></div>`:""}<div class="grand"><span>الإجمالي</span><span>${(order.total||0).toLocaleString()} ${CUR}</span></div>${tronAmount>0?`<div style="color:#1565c0;margin-top:4px"><span>💠 الترون</span><span>${tronAmount.toLocaleString()} ${CUR}</span></div>`:""}<div style="margin-top:6px;font-size:12px"><span>طريقة الدفع</span><span>${payLabel}</span></div></div>${tronAmount>0?`<div class="tron">💠 مبلغ الترون: ${tronAmount.toLocaleString()} ${CUR}</div>`:""}</div>${order.notes?`<div style="background:#fff9e6;border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;color:#795548">📝 ${order.notes}</div>`:""}<div class="footer"><p>شكراً لزيارتكم ☕</p>${staffName?`<p style="margin-top:4px;font-weight:700">الموظف: ${staffName}</p>`:""}<p style="margin-top:6px">${cafeName} — ${signature}</p></div></div></div><script>window.addEventListener('load',()=>{window.print();});</script></body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "width=450,height=700");
  if (win) { win.onafterprint = () => URL.revokeObjectURL(url); }
  else { const a = document.createElement("a"); a.href = url; a.download = `فاتورة_${order.orderNum||order.id}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return url;
};


export const saveReceiptRecord = (order, settings, store, tronAmount = 0) => {
  const receipt = {
    id: "rcpt_" + order.id + "_" + Date.now(),
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
