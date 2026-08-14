// sim/backup_test.mjs — v46
// اختبار قراءة النسخة الاحتياطية والاستعادة، بلا واجهة ولا شبكة.
// شغّله بـ:  npm run test:backup
import assert from "node:assert";

// بيئة متصفح مصغّرة (الوحدة تلمس localStorage و Blob)
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
};

const { buildBackup, readBackupFile, applyBackup, backupDue, backupFilename } =
  await import("../src/lib/backup.js");

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };
const ta = async (name, fn) => { await fn(); pass++; console.log("  ✓", name); };

const store = {
  menu: [{ id: "m1", name: "لاتيه", price: 5000 }],
  orders: [{ id: "o1", orderNum: "1", total: 5000 }, { id: "o2", orderNum: "2", total: 3000 }],
  shifts: [{ id: "s1" }],
  debts: [], expenses: [{ id: "e1", amount: 100 }], customers: [],
  cashLog: [], compLog: [], supplies: [],
  users: [{ id: "u1", name: "زين", role: "admin", password: "SECRET-HASH" }],
  settings: { cafeName: "ناردين", currency: "ل.س" },
};

// ملف وهمي يحاكي File.text()
const fakeFile = (obj) => ({ text: async () => (typeof obj === "string" ? obj : JSON.stringify(obj)) });

console.log("\n▸ بناء النسخة");
t("يحمل البيانات والعدّادات", () => {
  const b = buildBackup(store);
  assert.equal(b._meta.app, "nardeen-caffe");
  assert.equal(b._meta.counts.orders, 2);
  assert.equal(b.menu.length, 1);
});
t("لا يصدّر كلمات المرور أبداً", () => {
  const b = buildBackup(store);
  assert.equal(b.users.length, 1);
  assert.equal(b.users[0].password, undefined);
  assert.ok(!JSON.stringify(b).includes("SECRET-HASH"));
});
t("اسم الملف مؤرّخ", () => {
  assert.match(backupFilename(), /^nardeen-backup-\d{4}-\d{2}-\d{2}\.json$/);
});

console.log("\n▸ قراءة الملف");
await ta("يقرأ نسخة سليمة ويعاين محتواها", async () => {
  const r = await readBackupFile(fakeFile(buildBackup(store)));
  const byKey = Object.fromEntries(r.preview.map(p => [p.key, p.count]));
  assert.equal(byKey.orders, 2);
  assert.equal(byKey.menu, 1);
  assert.ok(r.takenAt);
});
await ta("يرفض ملفاً ليس JSON", async () => {
  await assert.rejects(() => readBackupFile(fakeFile("<html>لست ملفاً</html>")), /JSON/);
});
await ta("يرفض JSON من تطبيق آخر", async () => {
  await assert.rejects(() => readBackupFile(fakeFile({ foo: "bar" })), /ناردين/);
});
await ta("يرفض غياب الملف", async () => {
  await assert.rejects(() => readBackupFile(null), /ملف/);
});
await ta("يقبل نسخة قديمة بلا _meta ما دام فيها جداول معروفة", async () => {
  const r = await readBackupFile(fakeFile({ menu: [{ id: "m9" }], orders: [] }));
  assert.equal(r.takenAt, null);
  assert.ok(r.preview.some(p => p.key === "menu"));
});

console.log("\n▸ الاستعادة");
const mkTarget = () => {
  const w = {};
  return {
    written: w,
    setMenu: v => { w.menu = v; }, setOrders: v => { w.orders = v; },
    setDebts: v => { w.debts = v; }, setExpenses: v => { w.expenses = v; },
    setCustomers: v => { w.customers = v; }, setCompLog: v => { w.compLog = v; },
    setSettings: fn => { w.settings = typeof fn === "function" ? fn({ old: 1 }) : fn; },
  };
};

await ta("تستعيد الجداول المختارة فقط", async () => {
  const { data } = await readBackupFile(fakeFile(buildBackup(store)));
  const tgt = mkTarget();
  applyBackup(tgt, data, ["menu"]);
  assert.equal(tgt.written.menu.length, 1);
  assert.equal(tgt.written.orders, undefined);   // لم يُختَر ⇒ لم يُكتب
});
await ta("تدمج الإعدادات ولا تمسح الحقول الموجودة", async () => {
  const { data } = await readBackupFile(fakeFile(buildBackup(store)));
  const tgt = mkTarget();
  applyBackup(tgt, data, ["settings"]);
  assert.equal(tgt.written.settings.old, 1);          // القديم باقٍ
  assert.equal(tgt.written.settings.cafeName, "ناردين"); // والجديد طُبِّق
});
await ta("لا تستعيد المستخدمين إطلاقاً (وإلا قُفل الجميع خارج النظام)", async () => {
  const { data } = await readBackupFile(fakeFile(buildBackup(store)));
  const tgt = mkTarget();
  tgt.setUsers = () => { throw new Error("يجب ألّا تُستدعى"); };
  applyBackup(tgt, data, null);
  assert.equal(tgt.written.users, undefined);
});
await ta("تعيد قائمة بما استُعيد", async () => {
  const { data } = await readBackupFile(fakeFile(buildBackup(store)));
  const done = applyBackup(mkTarget(), data, ["menu", "orders"]);
  assert.equal(done.length, 2);
  assert.ok(done.some(x => x.includes("الطلبات")));
});

console.log("\n▸ دورية النسخة");
t("لا نسخة سابقة ⇒ مستحقّة", () => {
  localStorage.removeItem("nc_backup_at");
  assert.equal(backupDue(), true);
});
t("نسخة اليوم ⇒ غير مستحقّة", () => {
  localStorage.setItem("nc_backup_at", new Date().toISOString());
  assert.equal(backupDue(), false);
});
t("نسخة عمرها 8 أيام ⇒ مستحقّة", () => {
  localStorage.setItem("nc_backup_at", new Date(Date.now() - 8 * 86400000).toISOString());
  assert.equal(backupDue(), true);
});
t("ختم تالف ⇒ مستحقّة (لا تعطّل)", () => {
  localStorage.setItem("nc_backup_at", "ليس تاريخاً");
  assert.equal(backupDue(), true);
});

console.log(`\n✅ نجحت ${pass} حالة اختبار\n`);
