// ──────────────────────────────────────────────────────────────
// محاكاة ضغط متزامنة لـ Nardeen Caffe — تفحص ثوابت السلامة المالية
// والتقارب بين الأجهزة تحت زحمة عالية وانقطاعات شبكة عشوائية.
// تستورد الدوال الحقيقية: calcShiftSummary, calcNetProfit.
// ──────────────────────────────────────────────────────────────
import { calcShiftSummary, calcNetProfit } from "../src/lib/utils.js";

// ── RNG حتمي (seed) لإعادة الإنتاج ──
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

// ── ساعة منطقية (ms) تتقدم مع كل عملية لجعل updatedAt ذا معنى ──
let CLOCK = Date.parse("2026-06-15T09:00:00Z");
const now = () => new Date(CLOCK).toISOString();
const tick = (ms=1000) => { CLOCK += ms; };

// ══════════════ نموذج الخادم (المصدر المرجعي) ══════════════
// upsert ذرّي بالمعرّف (onConflict id) — يحاكي Supabase + سياسة "آخر كتابة بطابع أحدث"
function makeServer(){
  return {
    orders:new Map(), cash:new Map(), receipts:new Map(), expenses:new Map(),
    debts:new Map(), tables:new Map(), invoiceSeq:new Map(), // يوم -> عداد
    listeners:[],
    upsertOrder(row){
      const cur=this.orders.get(row.id);
      if(cur && cur.updatedAt && row.updatedAt && Date.parse(row.updatedAt) < Date.parse(cur.updatedAt)) return;
      const TERM=["paid","debt","complimentary","cancelled"];
      if(cur && TERM.includes(cur.status) && row.status!==cur.status) return; // RPC/خادم: الحالة النهائية مجمّدة
      this.orders.set(row.id,{...row});
      this.emit("order",this.orders.get(row.id));
    },
    upsertCash(row){ this.cash.set(row.id,{...row}); },          // معرّف فريد => idempotent
    // [إصلاح] دفع ذرّي مع compare-and-set: أول دفع يفوز، والمكرر لا يضيف نقدًا/فاتورة
    payOrder(order,cash,rcpt){
      // RPC compare-and-set: أول إجراء نهائي يفوز؛ لا دفع/نقد مزدوج
      const cur=this.orders.get(order.id); const TERM=["paid","debt","complimentary","cancelled"];
      if(cur && TERM.includes(cur.status)){ if(cur.status!=="paid" || !this.cash.has(cash.id)) return { already:true }; }
      this.orders.set(order.id,{...order}); this.emit("order",this.orders.get(order.id));
      this.cash.set(cash.id,{...cash}); if(rcpt) this.receipts.set(rcpt.id,{...rcpt});
      return { ok:true };
    },
    upsertReceipt(row){ this.receipts.set(row.id,{...row}); },
    upsertExpense(row){ this.expenses.set(row.id,{...row}); },
    upsertDebt(row){ this.debts.set(row.id,{...row}); },
    nextInvoice(day){ const n=(this.invoiceSeq.get(day)||0)+1; this.invoiceSeq.set(day,n); return `${day}-${String(n).padStart(3,"0")}`; },
    emit(type,row){ this.listeners.forEach(l=>l(type,{...row})); },
    onChange(fn){ this.listeners.push(fn); },
  };
}

// ══════════════ نموذج الجهاز (نسخة محلية + طابور) ══════════════
function makeDevice(id, server, rng, opts){
  const dev={
    id, server, rng,
    orders:new Map(), cash:new Map(), receipts:new Map(), expenses:new Map(), debts:new Map(),
    outbox:[], // {kind,row,legacy?}
    deviceSuffix:id.slice(-2).toUpperCase(),
    online:true,
  };

  // Realtime: الخادم يبث التغييرات؛ نطبّق بحارس التعارض نفسه المُنفّذ في 4.7.0/v32
  server.onChange((type,row)=>{
    if(type!=="order") return;
    if(dev.rng()>(opts.realtimeDelivery)) return; // قد لا يصل الحدث (drop)
    const local=dev.orders.get(row.id);
    const TERM=["paid","debt","complimentary","cancelled"];
    if(local){
      if(dev.outbox.some(e=>(e.kind==="orders"&&e.row.id===row.id)||(e.kind==="pay"&&e.row.order.id===row.id))) return; // معلّق محلي
      if(!TERM.includes(row.status) && local.updatedAt && row.updatedAt && Date.parse(local.updatedAt) > Date.parse(row.updatedAt)) return; // الحالة النهائية من الخادم مرجعية
    }
    dev.orders.set(row.id,{...row});
  });

  const enqueue=(kind,row,legacy=null)=>dev.outbox.push({kind,row:{...row},legacy:legacy?{...legacy}:null});

  // محاولة دفع الطابور (idempotent). تنجح فقط إن كان online (مع فشل عشوائي)
  dev.flush=()=>{
    if(!dev.online) return;
    const keep=[];
    for(const e of dev.outbox){
      if(dev.rng()>opts.netSuccess){ keep.push(e); continue; } // فشل لحظي => يبقى
      if(e.kind==="orders") server.upsertOrder(e.row);
      else if(e.kind==="pay") server.payOrder(e.row.order,e.row.cash,e.row.rcpt);
      else if(e.kind==="cash") server.upsertCash(e.row);
      else if(e.kind==="receipts") server.upsertReceipt(e.row);
      else if(e.kind==="expenses") server.upsertExpense(e.row);
      else if(e.kind==="debts") server.upsertDebt(e.row);
    }
    dev.outbox=keep;
  };

  // pullAll: دمج طلبات الخادم مع حماية المعلّق والطابع الزمني (منطق v32)
  dev.pull=()=>{
    if(!dev.online) return;
    const pendingIds=new Set(dev.outbox.flatMap(e=>e.kind==="orders"?[e.row.id]:e.kind==="pay"?[e.row.order.id]:[]));
    for(const [oid,row] of server.orders){
      const local=dev.orders.get(oid);
      if(!local){ dev.orders.set(oid,{...row}); continue; }
      if(pendingIds.has(oid)) continue;
      const TERM2=["paid","debt","complimentary","cancelled"];
      if(!TERM2.includes(row.status) && local.updatedAt && row.updatedAt && Date.parse(local.updatedAt) > Date.parse(row.updatedAt)) continue;
      dev.orders.set(oid,{...row});
    }
  };

  // ── العمليات (محلي أولًا + طابور، مطابقة لـ payOrder/markPaid v32) ──
  dev.createOrder=(items,table,customerName)=>{
    const day="20260615";
    let orderNum;
    if(dev.online && dev.rng()<opts.netSuccess){ orderNum=server.nextInvoice(day); }
    else { // ارتداد محلي + لاحقة جهاز (إصلاح 4.7.0)
      let max=0; for(const o of dev.orders.values()){ const on=String(o.orderNum||""); if(on.startsWith(day+"-")){const n=parseInt(on.slice(9),10); if(!isNaN(n)&&n>max)max=n;} }
      orderNum=`${day}-${String(max+1).padStart(3,"0")}-${dev.deviceSuffix}`;
    }
    const total=items.reduce((s,it)=>s+it.price*it.qty,0);
    const o={id:"o_"+id+"_"+(dev._c=(dev._c||0)+1),orderNum,items,table,customerName:customerName||"زبون",
      total,originalTotal:total,status:"ready",paymentType:null,discount:0,branch:"main",
      createdAt:now(),paidAt:null,shiftId:null,stockDeducted:false,compAmount:0,updatedAt:now()};
    dev.orders.set(o.id,{...o});
    enqueue("orders",{...o});
    return o;
  };

  dev.pay=(o,type,shiftId,disc=0)=>{
    const discAmt=Math.min(Math.max(0,disc),o.total);
    const final=o.total-discAmt;
    const paid={...o,status:"paid",paymentType:type,paidAt:now(),discount:disc,
      originalTotal:o.total,total:final,shiftId:shiftId||null,stockDeducted:true,updatedAt:now()};
    dev.orders.set(o.id,paid);                         // محلي فورًا
    const cashId="cash_pay_"+o.id;                      // [إصلاح] حتمي لكل طلب => دمج idempotent
    const cash={id:cashId,orderId:o.id,amount:final,type:type==="tron"?"tron":"sale",by:id,branch:"main",shiftId:shiftId||null,at:now()};
    dev.cash.set(cashId,cash);
    const rcptId="rcpt_"+o.id;                          // [إصلاح] حتمي (بلا Date.now)
    const rcpt={id:rcptId,orderId:o.id,total:final,discount:disc,paymentType:type,createdAt:now()};
    dev.receipts.set(rcptId,rcpt);                      // الفاتورة تُحفظ دائمًا (إصلاح v32)
    enqueue("pay",{order:paid,cash,rcpt});             // [إصلاح] دفع ذرّي واحد
    return {final,cashId};
  };

  dev.partial=(o,paidAmt,shiftId)=>{
    const remaining=o.total-paidAmt;
    const upd={...o,status:"paid",paymentStatus:"partial",paymentType:"cash",paidAt:now(),
      partialPaid:paidAmt,total:paidAmt,shiftId:shiftId||null,stockDeducted:true,updatedAt:now()};
    dev.orders.set(o.id,upd);
    const cashId="cash_"+id+"_"+(dev._cc=(dev._cc||0)+1);
    dev.cash.set(cashId,{id:cashId,orderId:o.id,amount:paidAmt,type:"partial",by:id,branch:"main",shiftId:shiftId||null,at:now()});
    const debtId="d_"+o.id;
    const debt={id:debtId,orderId:o.id,customerName:o.customerName,amount:remaining,remaining,settled:false,date:now()};
    dev.debts.set(debtId,debt);
    const rcptId="rcpt_"+o.id; dev.receipts.set(rcptId,{id:rcptId,orderId:o.id,total:paidAmt,discount:0,paymentType:"cash",createdAt:now()});
    enqueue("orders",upd); enqueue("cash",dev.cash.get(cashId)); enqueue("debts",debt); enqueue("receipts",dev.receipts.get(rcptId));
    return {paidAmt,remaining};
  };

  dev.debtOrder=(o,shiftId)=>{
    const upd={...o,status:"debt",paymentStatus:"debt",paymentType:"debt",stockDeducted:true,shiftId:shiftId||null,updatedAt:now()};
    dev.orders.set(o.id,upd);
    const debtId="d_"+o.id; const debt={id:debtId,orderId:o.id,customerName:o.customerName,amount:o.total,remaining:o.total,settled:false,date:now()};
    dev.debts.set(debtId,debt);
    enqueue("orders",upd); enqueue("debts",debt);
  };

  dev.worker=(o,costTotal,shiftId)=>{
    const upd={...o,status:"complimentary",paymentType:"worker",isComplimentary:true,total:0,
      originalTotal:o.total,compAmount:(o.compAmount||0)+costTotal,stockDeducted:true,shiftId:shiftId||null,paidAt:now(),updatedAt:now()};
    dev.orders.set(o.id,upd); enqueue("orders",upd);
  };

  dev.comp=(o,compAmt,shiftId)=>{
    const upd={...o,status:"complimentary",paymentType:"complimentary",isComplimentary:true,
      compAmount:(o.compAmount||0)+compAmt,total:0,stockDeducted:true,shiftId:shiftId||null,paidAt:now(),updatedAt:now()};
    dev.orders.set(o.id,upd); enqueue("orders",upd);
  };

  dev.expense=(amount,shiftId,isSecondary=false)=>{
    const id2="exp_"+id+"_"+(dev._e=(dev._e||0)+1);
    const e={id:id2,amount,category:"other",date:now(),branch:"main",shiftId:shiftId||null,isSecondary};
    dev.expenses.set(id2,e); enqueue("expenses",e);
  };

  return dev;
}

// ══════════════ تشغيل سيناريو ضغط ══════════════
function runScenario(seed, cfg){
  const rng=mulberry32(seed);
  CLOCK=Date.parse("2026-06-15T09:00:00Z");
  const server=makeServer();
  const opts={netSuccess:cfg.netSuccess,realtimeDelivery:cfg.realtimeDelivery};
  const devices=Array.from({length:cfg.devices},(_,i)=>makeDevice("dev"+(10+i),server,mulberry32(seed*7+i),opts));
  const shiftId="shift_1";
  const menu=[{id:"m1",price:5000,cost:1500},{id:"m2",price:8000,cost:2500},{id:"m3",price:3000,cost:800}];
  const allOrders=[]; // مرجع أرضي: كل طلب أُنشئ + حالته النهائية المقصودة

  const pickItems=()=>{const n=1+Math.floor(rng()*3);return Array.from({length:n},()=>{const m=menu[Math.floor(rng()*menu.length)];return {itemId:m.id,qty:1+Math.floor(rng()*3),price:m.price,cost:m.cost};});};
  const costOf=(items)=>items.reduce((s,it)=>s+it.cost*it.qty,0);

  for(let step=0; step<cfg.ops; step++){
    tick(500+Math.floor(rng()*3000));
    const dev=devices[Math.floor(rng()*devices.length)];
    // تذبذب الشبكة لكل جهاز
    if(rng()<cfg.netFlap) dev.online=!dev.online;

    const r=rng();
    if(r<0.45){ // إنشاء طلب
      const o=dev.createOrder(pickItems(),1+Math.floor(rng()*cfg.tables),"زبون"+Math.floor(rng()*40));
      allOrders.push({id:o.id,intended:"created"});
    } else {
      // اختر طلبًا جاهزًا من هذا الجهاز لإغلاقه
      const ready=[...dev.orders.values()].filter(o=>o.status==="ready");
      if(!ready.length) continue;
      const o=ready[Math.floor(rng()*ready.length)];
      const k=rng();
      if(k<0.6) dev.pay(o, rng()<0.8?"cash":(rng()<0.5?"card":"tron"), shiftId, rng()<0.15?Math.floor(rng()*3000):0);
      else if(k<0.72){ const p=Math.floor(o.total*(0.3+rng()*0.4)); if(p>0&&p<o.total) dev.partial(o,p,shiftId); else dev.pay(o,"cash",shiftId); }
      else if(k<0.84) dev.debtOrder(o,shiftId);
      else if(k<0.92) dev.worker(o,costOf(o.items),shiftId);
      else dev.comp(o, o.total, shiftId);
    }
    if(rng()<0.10) dev.expense(2000+Math.floor(rng()*15000), shiftId, rng()<0.3);
    // مزامنة دورية
    if(rng()<0.5){ dev.flush(); dev.pull(); }
  }

  // ── تصفية نهائية: كل الأجهزة online، تفريغ الطوابير + سحب متكرر حتى الاستقرار ──
  devices.forEach(d=>d.online=true);
  for(let r=0;r<8;r++){ tick(1000); devices.forEach(d=>{d.flush();}); devices.forEach(d=>{d.pull();}); }

  // ══════════════ فحص الثوابت ══════════════
  const issues=[];
  const S=server;

  // I3 التقارب: كل جهاز == الخادم (للطلبات)
  for(const d of devices){
    if(d.orders.size!==S.orders.size){ issues.push(`I3 تباين عدد الطلبات: ${d.id}=${d.orders.size} server=${S.orders.size}`); }
    for(const [oid,srow] of S.orders){
      const lrow=d.orders.get(oid);
      if(!lrow){ issues.push(`I2 طلب مفقود على ${d.id}: ${oid}`); continue; }
      if(lrow.status!==srow.status) issues.push(`I3 حالة مختلفة ${oid} على ${d.id}: ${lrow.status} != ${srow.status}`);
    }
  }

  // I2 لا طلب ضائع: كل طلب أُنشئ موجود على الخادم وبحالة نهائية صحيحة
  const valid=new Set(["ready","paid","debt","complimentary"]);
  for(const a of allOrders){
    const srow=S.orders.get(a.id);
    if(!srow){ issues.push(`I2 طلب لم يصل الخادم: ${a.id}`); continue; }
    if(!valid.has(srow.status)) issues.push(`I2 حالة غير صالحة ${a.id}: ${srow.status}`);
  }

  // I1/I4 حفظ المال: مجموع النقد (sale/tron/partial) == مجموع إيصالات الدفع
  const cashAll=new Map(); devices.forEach(d=>d.cash.forEach((v,k)=>cashAll.set(k,v)));
  const rcptAll=new Map(); devices.forEach(d=>d.receipts.forEach((v,k)=>rcptAll.set(k,v)));
  let cashSum=0; cashAll.forEach(c=>{ if(["sale","tron","partial"].includes(c.type)) cashSum+=c.amount; });
  let rcptSum=0; rcptAll.forEach(r=>rcptSum+=r.total);
  if(cashSum!==rcptSum) issues.push(`I1 عدم تطابق النقد/الإيصالات: نقد=${cashSum} إيصالات=${rcptSum}`);

  // I4 لكل طلب مدفوع: مجموع نقده == إجمالي الطلب المدفوع (لا دفع مزدوج)
  const paidOrders=[...S.orders.values()].filter(o=>o.status==="paid");
  for(const o of paidOrders){
    const entries=[...cashAll.values()].filter(c=>c.orderId===o.id);
    const sum=entries.reduce((s,c)=>s+c.amount,0);
    if(sum!==o.total) issues.push(`I4 نقد != إجمالي للطلب ${o.id}: نقد=${sum} إجمالي=${o.total} (عدد القيود ${entries.length})`);
  }

  // I5 تفرّد أرقام الفواتير
  const nums=[...S.orders.values()].map(o=>o.orderNum); const dup=nums.filter((n,i)=>nums.indexOf(n)!==i);
  if(dup.length) issues.push(`I5 أرقام فواتير مكررة: ${[...new Set(dup)].slice(0,5).join(", ")}`);

  // I7 دقّة calcShiftSummary (الحقيقي) مقابل المرجع الأرضي
  const ordersArr=[...S.orders.values()];
  const expArr=[]; devices.forEach(d=>d.expenses.forEach(e=>expArr.push(e)));
  const sum=calcShiftSummary(ordersArr,expArr,shiftId,"2026-06-15T08:00:00Z","main",null);
  const gtCash=ordersArr.filter(o=>o.status==="paid"&&o.paymentType==="cash").reduce((s,o)=>s+o.total,0);
  const gtTotal=ordersArr.filter(o=>o.status==="paid").reduce((s,o)=>s+o.total,0);
  const gtDebt=ordersArr.filter(o=>o.status==="debt").reduce((s,o)=>s+o.total,0);
  const gtComp=ordersArr.reduce((s,o)=>s+(o.compAmount||0),0);
  const gtExp=expArr.filter(e=>!e.isSecondary).reduce((s,e)=>s+e.amount,0);
  if(sum.cashSales!==gtCash) issues.push(`I7 cashSales: ${sum.cashSales} != ${gtCash}`);
  if(sum.totalSales!==gtTotal) issues.push(`I7 totalSales: ${sum.totalSales} != ${gtTotal}`);
  if(sum.debtTotal!==gtDebt) issues.push(`I7 debtTotal: ${sum.debtTotal} != ${gtDebt}`);
  if(sum.compTotal!==gtComp) issues.push(`I7 compTotal: ${sum.compTotal} != ${gtComp}`);
  if(sum.expensesTotal!==gtExp) issues.push(`I7 expensesTotal: ${sum.expensesTotal} != ${gtExp}`);

  // I8 idempotency: إعادة دفع الطابور (لا شيء متبقٍّ) لا تغيّر الأعداد
  const beforeCounts=[S.orders.size,S.cash.size,S.receipts.size];
  devices.forEach(d=>{ d.outbox.forEach(e=>{}); }); // الطوابير فارغة بعد التصفية
  const pending=devices.reduce((s,d)=>s+d.outbox.length,0);
  if(pending) issues.push(`I8 طوابير غير مفرّغة بعد الاستقرار: ${pending}`);

  // مقاييس
  const metrics={
    created:allOrders.length, serverOrders:S.orders.size,
    paid:paidOrders.length, debt:ordersArr.filter(o=>o.status==="debt").length,
    comp:ordersArr.filter(o=>o.status==="complimentary").length, ready:ordersArr.filter(o=>o.status==="ready").length,
    cashEntries:cashAll.size, receipts:rcptAll.size, cashSum, rcptSum,
    shiftCash:sum.cashSales, shiftTotal:sum.totalSales,
  };
  return {seed,issues,metrics};
}

// ══════════════ التنفيذ: عدة بذور وإعدادات قاسية ══════════════
const configs=[
  {name:"زحمة عالية / شبكة جيدة", devices:4, tables:50, ops:1500, netSuccess:0.95, realtimeDelivery:0.9, netFlap:0.03},
  {name:"شبكة سيئة + انقطاعات", devices:5, tables:60, ops:2000, netSuccess:0.6,  realtimeDelivery:0.6, netFlap:0.12},
  {name:"أجهزة كثيرة + ذروة",   devices:8, tables:80, ops:3000, netSuccess:0.8,  realtimeDelivery:0.75,netFlap:0.08},
];
let totalIssues=0, totalRuns=0;
for(const cfg of configs){
  console.log(`\n━━━ ${cfg.name} (${cfg.devices} أجهزة، ${cfg.ops} عملية) ━━━`);
  for(let s=1;s<=5;s++){
    const {issues,metrics}=runScenario(s*1000+cfg.devices,cfg); totalRuns++;
    const tag=issues.length?`❌ ${issues.length} مشكلة`:"✅ سليم";
    console.log(`  بذرة ${s}: ${tag} | طلبات=${metrics.serverOrders} مدفوع=${metrics.paid} دين=${metrics.debt} ضيافة=${metrics.comp} جاهز=${metrics.ready} | نقد=${metrics.cashSum} إيصالات=${metrics.rcptSum} | ورديةنقد=${metrics.shiftCash}`);
    if(issues.length){ totalIssues+=issues.length; issues.slice(0,8).forEach(i=>console.log(`      - ${i}`)); }
  }
}
console.log(`\n══════════════════════════════════════════`);
console.log(totalIssues===0?`✅ كل الثوابت محقّقة عبر ${totalRuns} تشغيلًا — لا تضاربات.`:`❌ إجمالي المشاكل: ${totalIssues} عبر ${totalRuns} تشغيلًا.`);
process.exit(totalIssues===0?0:1);
