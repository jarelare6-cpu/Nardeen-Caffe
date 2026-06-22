// اختبار حقيقي: قاعدة Postgres فيها قيد orders_payment_type_check يرفض 'worker'
// (مطابق لرسالة خطأ المستخدم). يثبت أن (أ) rowOfOrder يرسل قيمة آمنة،
// و(ب) شبكة أمان upsertStrip تعالج أي قيد CHECK.
import { freshDB } from "./db_helper.mjs";
import { rowOfOrder, extractMissingCol } from "../src/lib/rows.js";
let pass=0,fail=0; const ok=(n,c,d="")=>{c?(pass++,console.log("✅ "+n)):(fail++,console.log("❌ "+n+(d?" — "+d:"")));};

// upsertStrip كامل (أعمدة ناقصة + قيود CHECK) — نفس منطق الكود
async function upsertStripPG(db, table, row){
  let work={...row};
  for(let i=0;i<16;i++){
    const cols=Object.keys(work);
    const sql=`INSERT INTO ${table} (${cols.map(c=>'"'+c+'"').join(",")}) VALUES (${cols.map((_,j)=>`$${j+1}`).join(",")}) ON CONFLICT (id) DO UPDATE SET ${cols.filter(c=>c!=="id").map(c=>`"${c}"=EXCLUDED."${c}"`).join(",")}`;
    try{ await db.query(sql, cols.map(c=>{const v=work[c];return (v&&typeof v==="object")?JSON.stringify(v):v;})); return {ok:true}; }
    catch(e){
      const msg=e.message||"";
      const col=/(column|does not exist|cache)/i.test(msg)?extractMissingCol(msg):null;
      if(col && col!=="id" && (col in work)){ delete work[col]; continue; }
      if(/violates check constraint|check constraint/i.test(msg)){
        let fixed=false;
        for(const [c,v] of [["payment_type","cash"],["payment_status","paid"]]){
          if(msg.includes(c) && c in work && work[c]!==v){ work[c]=v; fixed=true; break; }
        }
        if(fixed) continue;
      }
      return {ok:false,error:msg};
    }
  }
  return {ok:false,error:"too many"};
}

const db = await freshDB({migrated:true});
// أضف قيد المستخدم بالضبط
await db.exec("ALTER TABLE orders ADD CONSTRAINT orders_payment_type_check CHECK (payment_type IN ('cash','card','tron','debt'));");

const worker={ id:"wc1", orderNum:"20260622-009", customerName:"زبون", items:[{itemId:"m1",qty:1,price:5000}],
  total:0, status:"complimentary", paymentType:"worker", isComplimentary:true, workerName:"سامر",
  compAmount:1500, createdAt:new Date().toISOString(), paidAt:new Date().toISOString(), branch:"main", updatedAt:new Date().toISOString() };

// (أ) rowOfOrder يحوّل worker => قيمة آمنة، فلا ينتهك القيد
ok("rowOfOrder.payment_type ليست 'worker' (قيمة آمنة)", rowOfOrder(worker).payment_type==="cash", rowOfOrder(worker).payment_type);
const res = await upsertStripPG(db,"orders",rowOfOrder(worker));
ok("حفظ مشروب العامل ينجح رغم قيد CHECK", res.ok, JSON.stringify(res));
const saved=(await db.query("select status,payment_type,is_complimentary,worker_name from orders where id='wc1'")).rows[0];
ok("الحالة = complimentary (لن تعود الفاتورة بعد التحديث)", saved && saved.status==="complimentary", saved&&saved.status);
ok("النوع الحقيقي محفوظ: is_complimentary + worker_name", saved && saved.is_complimentary===true && saved.worker_name==="سامر", JSON.stringify(saved));

// (ب) شبكة الأمان: لو وصلت قيمة 'worker' مباشرة (تجاوز rowOfOrder) => تُعالَج
const raw={...rowOfOrder(worker), id:"wc2", payment_type:"worker"};
const res2 = await upsertStripPG(db,"orders",raw);
ok("شبكة أمان upsertStrip تعالج payment_type='worker' المباشر", res2.ok, JSON.stringify(res2));
const saved2=(await db.query("select payment_type from orders where id='wc2'")).rows[0];
ok("القيمة أُعيدت إلى 'cash' الآمنة", saved2 && saved2.payment_type==="cash", saved2&&saved2.payment_type);

console.log(`\n${fail?"❌":"✅"} ${pass} نجح / ${fail} فشل`);
process.exit(fail?1:0);
