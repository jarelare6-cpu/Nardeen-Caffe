// اختبار حقيقي: قاعدة Postgres تنقصها comp_amount/worker_name (حالة إنتاجية قديمة)
// + دالة rowOfOrder الحقيقية + منطق upsertStrip الحقيقي (extractMissingCol) =>
// يجب أن يُحفظ الطلب كـ complimentary فلا يعود للظهور بعد التحديث.
import { freshDB } from "./db_helper.mjs";
import { rowOfOrder } from "../src/lib/rows.js";
import { extractMissingCol } from "../src/lib/rows.js";

let pass=0,fail=0; const ok=(n,c,d="")=>{c?(pass++,console.log("✅ "+n)):(fail++,console.log("❌ "+n+(d?" — "+d:"")));};

// منطق upsertStrip نفسه لكن على PGlite (يستخدم extractMissingCol الحقيقي)
async function upsertStripPG(db, table, row){
  let work={...row};
  for(let i=0;i<16;i++){
    const cols=Object.keys(work);
    const vals=cols.map((_,j)=>`$${j+1}`).join(",");
    const upd=cols.filter(c=>c!=="id").map(c=>`"${c}"=EXCLUDED."${c}"`).join(",");
    const sql=`INSERT INTO ${table} (${cols.map(c=>'"'+c+'"').join(",")}) VALUES (${vals}) ON CONFLICT (id) DO UPDATE SET ${upd}`;
    try{ await db.query(sql, cols.map(c=>{const v=work[c];return (v&&typeof v==="object")?JSON.stringify(v):v;})); return {ok:true,stripped:Object.keys(row).filter(k=>!(k in work))}; }
    catch(e){
      const col=extractMissingCol(e.message);
      if(col && col!=="id" && (col in work)){ delete work[col]; continue; }
      return {ok:false,error:e.message};
    }
  }
  return {ok:false,error:"too many"};
}

const db = await freshDB({migrated:true});
// حالة إنتاجية قديمة: احذف الأعمدة التي يكتبها مشروب العامل
await db.exec("ALTER TABLE orders DROP COLUMN IF EXISTS comp_amount;");
await db.exec("ALTER TABLE orders DROP COLUMN IF EXISTS worker_name;");

// أنشئ الطلب أولاً كـ ready
const base={ id:"ow1", orderNum:"20260622-001", customerName:"زبون", items:[{itemId:"m1",qty:1,price:5000}], total:5000, status:"ready", paymentType:"cash", createdAt:new Date().toISOString(), branch:"main", updatedAt:new Date().toISOString() };
await upsertStripPG(db,"orders",rowOfOrder(base));

// أغلقه كمشروب عامل (يكتب comp_amount + worker_name + is_complimentary)
const worker={ ...base, status:"complimentary", paymentType:"worker", isComplimentary:true, total:0, compAmount:1500, workerName:"أحمد", paidAt:new Date().toISOString(), updatedAt:new Date().toISOString() };

// (أ) السلوك القديم: حذف عمودين فقط (stock_deducted/updated_at) => يفشل
{
  const ro=rowOfOrder(worker); const {stock_deducted,updated_at,...legacyOld}=ro;
  let failed=false;
  try{
    const cols=Object.keys(legacyOld); const sql=`INSERT INTO orders (${cols.map(c=>'"'+c+'"').join(",")}) VALUES (${cols.map((_,j)=>`$${j+1}`).join(",")}) ON CONFLICT (id) DO UPDATE SET ${cols.filter(c=>c!=="id").map(c=>`"${c}"=EXCLUDED."${c}"`).join(",")}`;
    await db.query(sql, cols.map(c=>{const v=legacyOld[c];return (v&&typeof v==="object")?JSON.stringify(v):v;}));
  }catch(e){ failed=true; }
  ok("fallback القديم (عمودان فقط) يفشل على القاعدة الناقصة (تأكيد سبب عودة الفاتورة)", failed);
}

// (ب) الإصلاح: upsertStrip يحذف الأعمدة الناقصة ويحفظ الطلب complimentary
const res = await upsertStripPG(db,"orders",rowOfOrder(worker));
ok("upsertStrip ينجح ويحذف الأعمدة الناقصة تلقائيًا", res.ok, JSON.stringify(res));
const saved = (await db.query("select status from orders where id='ow1'")).rows[0];
ok("حالة الطلب في القاعدة = complimentary (لن يعود للظهور بعد التحديث)", saved && saved.status==="complimentary", saved&&saved.status);
ok("الأعمدة المحذوفة هي الناقصة فقط", res.stripped && res.stripped.every(c=>["comp_amount","worker_name"].includes(c)), JSON.stringify(res.stripped));

// extractMissingCol على رسائل واقعية
ok("extractMissingCol: رسالة Postgres", extractMissingCol('column "comp_amount" of relation "orders" does not exist')==="comp_amount");
ok("extractMissingCol: رسالة PostgREST", extractMissingCol("Could not find the 'worker_name' column of 'orders' in the schema cache")==="worker_name");

console.log(`\n${fail?"❌":"✅"} ${pass} نجح / ${fail} فشل`);
process.exit(fail?1:0);
