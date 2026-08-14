// sim/replay_test.mjs — v45
// اختبار منطق «إعادة تشغيل الوردية» و«كاشف الفاقد» بلا واجهة ولا شبكة.
// شغّله بـ:  npm run test:replay
import assert from "node:assert";
import {
  shiftWindow, buildTimeline, buildSummary, detectSignals, buildWasteReport, rowTime, clockSkewMs,
} from "../src/lib/replay.js";

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

const iso = (min) => new Date(Date.UTC(2026, 7, 14, 10, 0, 0) + min * 60000).toISOString();

const shift = {
  id: "sh1", branch: "main", userName: "سامر",
  openedAt: iso(0), closedAt: iso(480), difference: -1500, status: "closed",
};

console.log("\n▸ نافذة الوردية");
t("تحسب البداية والنهاية", () => {
  const w = shiftWindow(shift);
  assert.equal(w.branch, "main");
  assert.equal(w.to - w.from, 480 * 60000);
});
t("الوردية المفتوحة تنتهي الآن", () => {
  const w = shiftWindow({ ...shift, closedAt: null });
  assert.ok(w.to >= Date.now() - 5000);
});
t("وردية بلا تاريخ فتح ترتدّ إلى null", () => {
  assert.equal(shiftWindow({ id: "x" }), null);
});

console.log("\n▸ الخط الزمني");
const activity = [
  { id: "a1", action: "إنشاء طلب", branch: "main", created_at: iso(10), server_at: iso(10) },
  { id: "a3", action: "دفع طلب",   branch: "main", created_at: iso(30), server_at: iso(30) },
  { id: "a2", action: "إلغاء طلب", branch: "main", created_at: iso(20), server_at: iso(20) },
  { id: "a4", action: "دفع طلب",   branch: "outdoor", created_at: iso(25), server_at: iso(25) },
  { id: "a5", action: "دفع طلب",   branch: "main", created_at: iso(900), server_at: iso(900) },
];
t("يرتّب زمنياً ويستبعد الفرع الآخر وما خرج عن النافذة", () => {
  const tl = buildTimeline(activity, shift);
  assert.deepEqual(tl.map(r => r.id), ["a1", "a2", "a3"]);
});
t("يفضّل ساعة الخادم على ساعة الجهاز", () => {
  const r = { created_at: iso(5), server_at: iso(9) };
  assert.equal(rowTime(r), new Date(iso(9)).getTime());
  assert.equal(clockSkewMs(r), 4 * 60000);
});
t("غياب server_at يرتدّ إلى created_at بلا كسر", () => {
  const tl = buildTimeline([{ id: "z", branch: "main", created_at: iso(15) }], shift);
  assert.equal(tl.length, 1);
});

console.log("\n▸ الإشارتان");
const orders = [
  // إلغاء بعد الجاهزية — إشارة عالية
  { id: "o1", orderNum: "101", branch: "main", shiftId: "sh1", status: "cancelled",
    createdAt: iso(40), readyAt: iso(55), updatedAt: iso(60), total: 12000, cancelReason: "الزبون غادر" },
  // إلغاء سريع — إشارة منخفضة
  { id: "o2", orderNum: "102", branch: "main", shiftId: "sh1", status: "cancelled",
    createdAt: iso(70), updatedAt: new Date(new Date(iso(70)).getTime() + 20000).toISOString(), total: 3000 },
  // إلغاء عادي بعد وقت طويل بلا تحضير — لا إشارة
  { id: "o3", orderNum: "103", branch: "main", shiftId: "sh1", status: "cancelled",
    createdAt: iso(80), updatedAt: iso(120), total: 5000 },
  // طلب مدفوع بخصم
  { id: "o4", orderNum: "104", branch: "main", shiftId: "sh1", status: "paid",
    createdAt: iso(90), originalTotal: 20000, total: 18000 },
  // وردية أخرى — يجب تجاهله
  { id: "o5", orderNum: "105", branch: "main", shiftId: "sh2", status: "cancelled",
    createdAt: iso(95), readyAt: iso(96), updatedAt: iso(97), total: 9000 },
];

t("يرفع إشارة عالية للإلغاء بعد الجاهزية", () => {
  const sig = detectSignals(orders, shift);
  const high = sig.filter(s => s.level === "high");
  assert.equal(high.length, 1);
  assert.equal(high[0].orderNum, "101");
  assert.equal(high[0].kind, "cancel_after_ready");
});
t("يرفع إشارة منخفضة للإلغاء السريع", () => {
  const sig = detectSignals(orders, shift);
  const low = sig.filter(s => s.level === "low");
  assert.equal(low.length, 1);
  assert.equal(low[0].orderNum, "102");
});
t("لا يرفع إشارتين لنفس الطلب", () => {
  const sig = detectSignals(orders, shift);
  assert.equal(new Set(sig.map(s => s.orderNum)).size, sig.length);
});
t("يتجاهل طلبات وردية أخرى", () => {
  assert.ok(!detectSignals(orders, shift).some(s => s.orderNum === "105"));
});
t("الإلغاء العادي لا يُرفع", () => {
  assert.ok(!detectSignals(orders, shift).some(s => s.orderNum === "103"));
});

console.log("\n▸ البطاقات الثلاث");
t("تعدّ الإلغاءات والخصومات وفرق الصندوق", () => {
  const sm = buildSummary(orders, shift);
  assert.equal(sm.cancels, 3);            // 101 + 102 + 103
  assert.equal(sm.discountValue, 2000);   // 20000 - 18000
  assert.equal(sm.difference, -1500);
  assert.equal(sm.ordersCount, 4);        // بلا o5
});

console.log("\n▸ كاشف الفاقد");
const now = Date.now();
const at = (d) => new Date(now - d * 86400000).toISOString();
const moves = [
  // بنّ: ينقص ثلاث مرات ولا يزيد ⇒ إشارة
  { id: "m1", itemId: "i1", itemName: "بنّ", reason: "correction", delta: -4, at: at(60) },
  { id: "m2", itemId: "i1", itemName: "بنّ", reason: "correction", delta: -3, at: at(30) },
  { id: "m3", itemId: "i1", itemName: "بنّ", reason: "correction", delta: -5, at: at(5) },
  // سكر: يتأرجح ⇒ خطأ قياس لا إشارة
  { id: "m4", itemId: "i2", itemName: "سكر", reason: "correction", delta: -6, at: at(40) },
  { id: "m5", itemId: "i2", itemName: "سكر", reason: "correction", delta: +7, at: at(20) },
  // شاي: نقص مرة واحدة ⇒ دون العتبة
  { id: "m6", itemId: "i3", itemName: "شاي", reason: "correction", delta: -9, at: at(10) },
  // بيع عادي — لا يدخل الحساب إطلاقاً
  { id: "m7", itemId: "i1", itemName: "بنّ", reason: "sale", delta: -50, at: at(3) },
  // خارج النافذة الزمنية
  { id: "m8", itemId: "i4", itemName: "قديم", reason: "correction", delta: -20, at: at(200) },
];
const menu = [{ id: "i1", cost: 500 }, { id: "i2", cost: 100 }, { id: "i3", cost: 200 }];

t("يرفع الصنف الناقص باستمرار فقط", () => {
  const w = buildWasteReport(moves, { days: 90, menu });
  const flagged = w.filter(x => x.flagged).map(x => x.itemName);
  assert.deepEqual(flagged, ["بنّ"]);
});
t("لا يحسب حركات البيع — فقط تصحيح الجرد", () => {
  const bun = buildWasteReport(moves, { days: 90, menu }).find(x => x.itemId === "i1");
  assert.equal(bun.shortQty, 12);   // 4+3+5 وليس 62
  assert.equal(bun.shortTimes, 3);
});
t("يحسب قيمة الخسارة من التكلفة", () => {
  const bun = buildWasteReport(moves, { days: 90, menu }).find(x => x.itemId === "i1");
  assert.equal(bun.net, -12);
  assert.equal(bun.lossValue, 6000); // 12 × 500
});
t("المتأرجح لا يُرفع", () => {
  const sug = buildWasteReport(moves, { days: 90, menu }).find(x => x.itemId === "i2");
  assert.equal(sug.flagged, false);
});
t("يستبعد ما هو أقدم من النافذة", () => {
  assert.ok(!buildWasteReport(moves, { days: 90, menu }).some(x => x.itemId === "i4"));
});
t("مدخلات فارغة لا تكسر شيئاً", () => {
  assert.deepEqual(buildWasteReport(null, {}), []);
  assert.deepEqual(buildTimeline(null, null), []);
  assert.deepEqual(detectSignals(null, null), []);
});

console.log(`\n✅ نجحت ${pass} حالة اختبار\n`);
