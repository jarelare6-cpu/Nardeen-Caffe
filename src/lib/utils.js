// src/lib/utils.js — Nardeen Caffe v3

export const playOrderAlert = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880,0],[660,0.12],[880,0.24]].forEach(([freq,start]) => {
      const osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(freq, ctx.currentTime+start);
      gain.gain.setValueAtTime(0.25, ctx.currentTime+start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+start+0.1);
      osc.start(ctx.currentTime+start); osc.stop(ctx.currentTime+start+0.12);
    });
  } catch { /* ignore */ }
};

export const exportToExcel = async (orders, menu) => {
  const XLSX = await import("xlsx");
  const rows = orders.map(o => ({
    "رقم الطلب":    o.orderNum||o.order_num,
    "الطاولة":      o.table||o.table_num||"—",
    "الزبون":       o.customerName||o.customer_name||"—",
    "الحالة":       {pending:"قيد الانتظار",preparing:"قيد التحضير",ready:"جاهز",paid:"مدفوع",cancelled:"ملغي"}[o.status]||o.status,
    "الإجمالي ل.س": o.total,
    "التاريخ":      new Date(o.createdAt||o.created_at).toLocaleString("ar-SY"),
    "الأصناف":      (o.items||[]).map(i=>`${i.itemName||i.item_name} ×${i.qty}`).join(" | "),
  }));
  const ws=XLSX.utils.json_to_sheet(rows);
  ws["!cols"]=[10,10,14,10,14,18,40].map(w=>({wch:w}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"الطلبات");
  XLSX.writeFile(wb,`nardeen-report-${new Date().toISOString().slice(0,10)}.xlsx`);
};

export const generateTableQR = async (tableNum) => {
  try {
    const QRCode = await import("qrcode");
    const url = `${window.location.origin}?table=${tableNum}`;
    return await QRCode.toDataURL(url,{width:256,margin:2,color:{dark:"#c62828",light:"#ffffff"}});
  } catch { return null; }
};

export const printOrder = (order, menu, copy=1, settings={}) => {
  const SIGNATURE = settings.signature || "بإدارة يحيى داؤود";
  const CAFE = settings.cafeName || "Nardeen Caffe";
  const CUR  = settings.currency || "ل.س";
  const items = (order.items||[]).map(i => {
    const m = (menu||[]).find(x=>x.id===i.itemId||x.id===i.item_id);
    return `<tr><td>${m?.name||i.itemName||i.item_name}</td><td style="text-align:center">${i.qty}</td><td style="text-align:left">${(i.price*i.qty).toLocaleString()} ${CUR}</td></tr>`;
  }).join("");
  const total = (order.items||[]).reduce((s,i)=>s+i.price*i.qty,0);
  const orderNum = order.orderNum||order.order_num;
  const table    = order.table||order.table_num;
  const custName = order.customerName||order.customer_name;
  const isDebt   = order.paymentType === "debt";
  const html = `<html dir="rtl"><head><meta charset="utf-8">
    <style>body{font-family:'Courier New',monospace;font-size:13px;padding:10px;max-width:300px;margin:auto}
    h2{text-align:center;color:#c62828;margin:0;font-size:18px}
    .sub{text-align:center;color:#2e7d32;font-size:11px;margin-bottom:8px}
    .copy{text-align:center;background:#333;color:#fff;padding:2px 8px;border-radius:10px;display:inline-block;font-size:10px}
    hr{border-top:1px dashed #999}table{width:100%;border-collapse:collapse}td{padding:3px 0}
    .total{font-weight:bold;font-size:16px}.footer{text-align:center;font-size:10px;color:#666;margin-top:8px}
    .debt-badge{background:#ffebee;color:#c62828;padding:4px 8px;border-radius:6px;font-weight:bold;text-align:center;margin:6px 0}
    @media print{body{max-width:100%}}</style></head><body>
    <h2>☕ ${CAFE}</h2>
    <div class="sub">${SIGNATURE}</div>
    <div style="text-align:center"><span class="copy">نسخة ${copy===1?"البار":"العميل"}</span></div>
    <hr>
    <div style="display:flex;justify-content:space-between;font-size:11px">
      <span>طلب رقم: <b>#${orderNum}</b></span>
      <span>${new Date(order.createdAt||order.created_at).toLocaleTimeString("ar-SY",{hour:"2-digit",minute:"2-digit"})}</span>
    </div>
    <div style="font-size:11px">طاولة: ${table||"—"} | ${custName?`الزبون: ${custName}`:"طلب عام"}</div>
    ${isDebt?`<div class="debt-badge">⚠ دين مسجّل على: ${custName||"الزبون"}</div>`:""}
    <hr>
    <table><thead><tr><td><b>الصنف</b></td><td style="text-align:center"><b>الكمية</b></td><td style="text-align:left"><b>المجموع</b></td></tr></thead>
    <tbody>${items}</tbody></table>
    <hr>
    ${order.discount>0?`<div style="font-size:11px;display:flex;justify-content:space-between"><span>قبل الخصم:</span><span>${(order.originalTotal||total).toLocaleString()} ${CUR}</span></div><div style="font-size:11px;display:flex;justify-content:space-between;color:#2e7d32"><span>خصم ${order.discount}%:</span><span>-${((order.originalTotal||total)-order.total).toLocaleString()} ${CUR}</span></div>`:""}
    <div style="display:flex;justify-content:space-between" class="total">
      <span>الإجمالي:</span><span>${order.total.toLocaleString()} ${CUR}</span>
    </div>
    <div class="footer">شكراً لزيارتكم ${CAFE}<br>${SIGNATURE}</div>
    </body></html>`;
  const w = window.open("","_blank","width=350,height=600");
  if(w){ w.document.write(html); w.document.close(); w.print(); }
};
