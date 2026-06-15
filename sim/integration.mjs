// ──────────────────────────────────────────────────────────────
// اختبار تكامل حقيقي: Postgres فعلي (PGlite) + مخطّطك الحقيقي +
// دوال الكتابة الحقيقية من الكود (src/lib/rows.js) — لا إعادة كتابة.
// يحاكي حالة قاعدتك الإنتاجية القديمة (قبل الهجرة) والمُرقّاة، ويختبر
// صراحةً: فشل الكتابة بعمود ناقص، ثم سحب يتأكد أن البيانات لم تختفِ.
// ──────────────────────────────────────────────────────────────
import { freshDB } from "./db_helper.mjs";
import { rowOfExpense, rowOfExpenseLegacy, rowOfOrder, rowOfCash, mapExpense } from "../src/lib/rows.js";

const results = [];
const rec = (name, pass, detail="") => { results.push({name,pass,detail}); console.log(`${pass?"✅":"❌"} ${name}${detail?"  — "+detail:""}`); };

// محاكاة دقيقة لـ sbUpsert الحقيقي: حاول الصف، وعند خطأ مخطّط جرّب fallback
const SCHEMA_ERR = /(column|schema|does not exist|could not find|cache)/i;
async function sbUpsertReal(db, table, row, fallbackRow=null){
  const ins = (r) => {
    const cols = Object.keys(r);
    const vals = cols.map((_,i)=>`$${i+1}`).join(",");
    const upd = cols.filter(c=>c!=="id").map(c=>`${c}=EXCLUDED.${c}`).join(",");
    const sql = `INSERT INTO ${table} (${cols.map(c=>'"'+c+'"').join(",")}) VALUES (${vals}) `+
                `ON CONFLICT (id) DO UPDATE SET ${upd}`;
    return db.query(sql, cols.map(c=>{const v=r[c]; return (v && typeof v==="object")?JSON.stringify(v):v;}));
  };
  try { await ins(row); return {error:null,used:"main"}; }
  catch(e){
    if (fallbackRow && SCHEMA_ERR.test(e.message||"")) {
      try { await ins(fallbackRow); return {error:null,used:"fallback"}; }
      catch(e2){ return {error:e2.message,used:"fallback-failed"}; }
    }
    return {error:e.message,used:"main-failed"};
  }
}

// يحوّل القاعدة المُرقّاة الحالية إلى "الحالة الإنتاجية القديمة" (قبل v4.7.0)
async function downgradeToOld(db){
  await db.exec("ALTER TABLE expenses DROP COLUMN IF EXISTS shift_id;");
  await db.exec("ALTER TABLE orders   DROP COLUMN IF EXISTS updated_at;");
  await db.exec("ALTER TABLE orders   ALTER COLUMN discount TYPE NUMERIC(6,2);");
  await db.exec("ALTER TABLE receipts ALTER COLUMN discount TYPE NUMERIC(6,2);");
}

const mkExpense = (i,shift="shift_1") => ({ id:"exp_"+i, description:"كهرباء "+i, amount:5000+i, category:"utilities", date:new Date().toISOString(), by:"كاشير", isSecondary:false, shiftId:shift });

// ══════════════ T1: القاعدة القديمة (قبل الهجرة) — سبب اختفاء المصاريف ══════════════
{
  const db = await freshDB({migrated:true});
  await downgradeToOld(db);

  // (أ) السلوك القديم المعطوب: كتابة بلا fallback => تفشل وتُفقد
  const r1 = await sbUpsertReal(db, "expenses", rowOfExpense(mkExpense(1)) /* بلا fallback */);
  const cnt1 = (await db.query("select count(*)::int c from expenses")).rows[0].c;
  rec("T1.a [قديم/بلا fallback] كتابة المصروف تفشل وتُفقد (تأكيد الخطأ الأصلي)",
      r1.error!==null && cnt1===0, `error=${(r1.error||"").slice(0,40)} | صفوف=${cnt1}`);

  // (ب) الإصلاح: كتابة مع fallback => تنجح رغم غياب العمود
  const r2 = await sbUpsertReal(db, "expenses", rowOfExpense(mkExpense(2)), rowOfExpenseLegacy(mkExpense(2)));
  const cnt2 = (await db.query("select count(*)::int c from expenses")).rows[0].c;
  rec("T1.b [قديم/مع fallback] المصروف يُحفظ (الإصلاح يعمل)",
      r2.error===null && r2.used==="fallback" && cnt2===1, `used=${r2.used} | صفوف=${cnt2}`);
}

// ══════════════ T2: القاعدة المُرقّاة — يجب أن يُحفظ shift_id ══════════════
{
  const db = await freshDB({migrated:true});
  const r = await sbUpsertReal(db, "expenses", rowOfExpense(mkExpense(3,"shiftX")), rowOfExpenseLegacy(mkExpense(3,"shiftX")));
  const row = (await db.query("select shift_id from expenses where id='exp_3'")).rows[0];
  rec("T2 [مُرقّى] المصروف يُحفظ مع shift_id (المسار الرئيسي)",
      r.error===null && r.used==="main" && row && row.shift_id==="shiftX", `used=${r.used} | shift_id=${row&&row.shift_id}`);
}

// ══════════════ T3: اختفاء المصاريف عند السحب (محاكاة pullAll) ══════════════
{
  // قاعدة قديمة، نكتب 3 مصاريف بالسلوك المعطوب (بلا fallback) ثم "نسحب"
  const dbOld = await freshDB({migrated:true}); await downgradeToOld(dbOld);
  for(let i=10;i<13;i++) await sbUpsertReal(dbOld,"expenses",rowOfExpense(mkExpense(i)));
  const cloudOld = (await dbOld.query("select * from expenses")).rows.map(mapExpense);
  rec("T3.a [قديم] السحب يُرجع صفرًا => المصاريف تختفي بعد المزامنة (الخطأ الأصلي)",
      cloudOld.length===0, `مصاريف في السحابة=${cloudOld.length}`);

  // مع الإصلاح (fallback): نفس السيناريو يحفظ ويُرجع البيانات
  const dbOld2 = await freshDB({migrated:true}); await downgradeToOld(dbOld2);
  for(let i=20;i<23;i++) await sbUpsertReal(dbOld2,"expenses",rowOfExpense(mkExpense(i)),rowOfExpenseLegacy(mkExpense(i)));
  const cloud2 = (await dbOld2.query("select * from expenses")).rows.map(mapExpense);
  rec("T3.b [مع الإصلاح] السحب يُرجع كل المصاريف => لا اختفاء",
      cloud2.length===3, `مصاريف في السحابة=${cloud2.length}`);
}

// ══════════════ T4: دقّة الخصم (NUMERIC) — خصم كبير ══════════════
{
  const baseOrder = { id:"o1", orderNum:"20260615-001", customerName:"زبون", items:[{itemId:"m1",qty:1,price:50000}], total:50000, discount:12000, status:"paid", paymentType:"cash", createdAt:new Date().toISOString(), paidAt:new Date().toISOString(), branch:"main", shiftId:"s1", stockDeducted:true, updatedAt:new Date().toISOString() };

  // قاعدة قديمة: discount NUMERIC(6,2) سقفه 9999.99 => خصم 12000 يفشل
  const dbOld = await freshDB({migrated:true}); await downgradeToOld(dbOld);
  const ro = rowOfOrder(baseOrder); const {stock_deducted,updated_at,...legacy}=ro;
  const rOld = await sbUpsertReal(dbOld,"orders",ro,legacy);
  rec("T4.a [قديم] خصم 12000 ل.س يُفشل كتابة الطلب (NUMERIC(6,2)=الخطأ #3)",
      rOld.error!==null, `error=${(rOld.error||"").slice(0,45)}`);

  // قاعدة مُرقّاة: NUMERIC(12,2) => ينجح
  const dbNew = await freshDB({migrated:true});
  const rNew = await sbUpsertReal(dbNew,"orders",ro,legacy);
  const saved = (await dbNew.query("select discount from orders where id='o1'")).rows[0];
  rec("T4.b [مُرقّى] الخصم الكبير يُحفظ (الإصلاح #3)",
      rNew.error===null && Number(saved.discount)===12000, `discount=${saved&&saved.discount}`);
}

// ══════════════ T5: حارس التزامن (Trigger) — أول إجراء نهائي يفوز ══════════════
{
  const db = await freshDB({migrated:true}); // الهجرة الموحّدة تُنشئ الـtrigger
  const ord = { id:"o2", orderNum:"20260615-002", customerName:"زبون", items:[], total:10000, status:"paid", paymentType:"cash", createdAt:new Date().toISOString(), paidAt:new Date().toISOString(), branch:"main", updatedAt:new Date().toISOString() };
  await sbUpsertReal(db,"orders",rowOfOrder(ord));
  // جهاز آخر متأخّر يحاول تحويله إلى "complimentary"
  await db.query("UPDATE orders SET status='complimentary' WHERE id='o2'");
  const st = (await db.query("select status from orders where id='o2'")).rows[0].status;
  rec("T5.a [trigger] تحويل طلب مدفوع إلى ضيافة مرفوض (يبقى paid)", st==="paid", `status=${st}`);
  // لكن الإلغاء (مرتجع) مسموح
  await db.query("UPDATE orders SET status='cancelled' WHERE id='o2'");
  const st2 = (await db.query("select status from orders where id='o2'")).rows[0].status;
  rec("T5.b [trigger] الإلغاء (مرتجع) مسموح", st2==="cancelled", `status=${st2}`);
}

// ══════════════ T6: تفرّد معرّف النقد (دفع مزدوج لا يضاعف) ══════════════
{
  const db = await freshDB({migrated:true});
  // جهازان يدفعان نفس الطلب => نفس معرّف النقد الحتمي cash_pay_<id>
  const cash = { id:"cash_pay_o3", orderId:"o3", orderNum:"x", amount:10000, at:new Date().toISOString(), by:"A", type:"sale", branch:"main" };
  await sbUpsertReal(db,"cash_log",rowOfCash(cash));
  await sbUpsertReal(db,"cash_log",rowOfCash({...cash, by:"B"})); // الجهاز الثاني، نفس المعرّف
  const c = (await db.query("select count(*)::int c, sum(amount)::int s from cash_log where order_id='o3'")).rows[0];
  rec("T6 [معرّف حتمي] دفع مزدوج لنفس الطلب => قيد نقد واحد فقط", c.c===1 && c.s===10000, `قيود=${c.c} مجموع=${c.s}`);
}

// ══════════════ T7: عقد المخطّط — كل حقل كتابة له عمود فعلي ══════════════
{
  const db = await freshDB({migrated:true});
  const cols = async (t) => new Set((await db.query(
    "select column_name from information_schema.columns where table_name=$1", [t])).rows.map(r=>r.column_name));
  const checks = [
    ["orders",   rowOfOrder({id:"x",items:[]})],
    ["cash_log", rowOfCash({id:"x"})],
    ["expenses", rowOfExpense({id:"x"})],
  ];
  let missing=[];
  for(const [t,row] of checks){
    const have = await cols(t);
    for(const k of Object.keys(row)) if(!have.has(k)) missing.push(`${t}.${k}`);
  }
  rec("T7 [عقد المخطّط] كل حقل في دوال الكتابة له عمود في القاعدة المُرقّاة",
      missing.length===0, missing.length?("ناقص: "+missing.join(", ")):"كل الحقول مغطّاة");
}

// ══════════════ النتيجة ══════════════
const failed = results.filter(r=>!r.pass);
console.log("\n══════════════════════════════════════════");
console.log(failed.length===0
  ? `✅ كل اختبارات التكامل الحقيقية نجحت (${results.length}/${results.length}) على Postgres فعلي.`
  : `❌ فشل ${failed.length} من ${results.length}:`);
failed.forEach(f=>console.log("   - "+f.name+"  ("+f.detail+")"));
process.exit(failed.length?1:0);
