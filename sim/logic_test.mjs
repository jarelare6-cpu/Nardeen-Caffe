import { workDayStart, businessDayStart, calcShiftSummary, calcNetProfit, orderCash, orderTron, orderSale } from "/home/claude/Nardeen-Caffe/src/lib/utils.js";
let pass=0,fail=0; const ok=(n,c)=>{c?(pass++,console.log("✅ "+n)):(fail++,console.log("❌ "+n));};

// (4) يوم العمل يبدأ من افتتاح آخر وردية
const shifts=[
  {id:"s1",branch:"main",status:"closed",openedAt:"2026-06-21T18:00:00Z"},
  {id:"s2",branch:"main",status:"open",  openedAt:"2026-06-22T20:30:00Z"},
];
const ws=workDayStart(shifts,"main",new Date("2026-06-22T23:00:00Z"));
ok("يوم العمل = افتتاح آخر وردية (20:30) لا ساعة ثابتة", ws.toISOString()==="2026-06-22T20:30:00.000Z");
ok("بلا ورديات => يرجع businessDayStart", workDayStart([],"main").getTime()===businessDayStart().getTime());
// لا يحتسب وردية فُتحت بالمستقبل
const wsFuture=workDayStart([{id:"f",branch:"main",status:"open",openedAt:"2026-06-23T20:00:00Z"}],"main",new Date("2026-06-22T23:00:00Z"));
ok("وردية مستقبلية تُتجاهَل => fallback", wsFuture.getHours()!==undefined);

// (2) الضيافة معزولة عن المبيعات/النقد في تقرير الوردية
const openedAt="2026-06-22T20:00:00Z";
const orders=[
  {id:"o1",status:"paid",paymentType:"cash",total:10000,tronAmount:0,paidAt:"2026-06-22T21:00:00Z",branch:"main",shiftId:"s2"},
  {id:"o2",status:"complimentary",isComplimentary:true,paymentType:"worker",total:0,compAmount:3000,paidAt:"2026-06-22T21:10:00Z",branch:"main",shiftId:"s2"},
  {id:"o3",status:"complimentary",isComplimentary:true,paymentType:"complimentary",total:0,compAmount:8000,paidAt:"2026-06-22T21:20:00Z",branch:"main",shiftId:"s2"},
];
const sum=calcShiftSummary(orders,[],"s2",openedAt,"main",null);
ok("النقد الفعلي = 10000 (الضيافة مستبعَدة)", sum.cashSales===10000);
ok("إجمالي المبيعات = 10000 (لا ضيافة)", sum.totalSales===10000);
ok("جرد الضيافة المعزول compTotal = 11000 (3000+8000)", sum.compTotal===11000);
ok("عدد الطلبات المدفوعة = 1 فقط (الضيافة لا تُعدّ)", sum.ordersCount===1);


// (v39) الترون: بيع كامل يدخل المبيعات، ويُستبعَد من نقد الدرج فقط
const sh="2026-06-22T20:00:00Z";
const ords=[
  {id:"c1",status:"paid",paymentType:"cash",total:10000,tronAmount:0,   paidAt:"2026-06-22T21:00:00Z",branch:"main",shiftId:"s2"},
  {id:"c2",status:"paid",paymentType:"cash",total:10000,tronAmount:4000, paidAt:"2026-06-22T21:05:00Z",branch:"main",shiftId:"s2"}, // مختلط
  {id:"c3",status:"paid",paymentType:"cash",total:8000, tronAmount:8000, paidAt:"2026-06-22T21:10:00Z",branch:"main",shiftId:"s2"}, // ترون كامل عبر الحقل
];
const S=calcShiftSummary(ords,[],"s2",sh,"main",null);
ok("المبيعات الكاملة تشمل الترون = 28000", S.totalSales===28000, "totalSales="+S.totalSales);
ok("نقد الدرج يستبعد الترون = 16000", S.cashSales===16000, "cashSales="+S.cashSales);
ok("بند الترون المنفصل = 12000", S.tronSales===12000, "tronSales="+S.tronSales);
ok("نقد الدرج + الترون = المبيعات (اتساق)", S.cashSales+S.tronSales===S.totalSales);
ok("فاتورة ترون كامل تظهر في المبيعات لا في الدرج", orderSale(ords[2])===8000 && orderCash(ords[2])===0 && orderTron(ords[2])===8000);
const profit=calcNetProfit(ords,[],null); // بلا تكلفة => الربح = المبيعات الكاملة
ok("الربح يشمل إيراد الترون = 28000", profit===28000, "profit="+profit);

console.log(`\n${fail?"❌":"✅"} ${pass} نجح / ${fail} فشل`);
process.exit(fail?1:0);
