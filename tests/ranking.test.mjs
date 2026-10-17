import test from "node:test";import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "../dev/server.mjs";
import { PASSWORD } from "../dev/seed.mjs";
test("สรุปผลสัมฤทธิ์: อันดับเกรดเฉลี่ยสูงสุด 3 อันดับแรกของแต่ละชั้น (คะแนนเท่ากันได้อันดับเดียวกัน)", async () => {
const O="http://school.test", env=await makeEnv();
const r=await worker.fetch(new Request(O+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:O},body:JSON.stringify({email:"admin@test.local",password:PASSWORD})}),env);
const ck=r.headers.get("Set-Cookie").split(";")[0];
const call=async(m,p,b)=>{const x=await worker.fetch(new Request(O+p,{method:m,headers:{"Content-Type":"application/json",Origin:O,Cookie:ck},body:b?JSON.stringify(b):undefined}),env);const j=await x.json().catch(()=>null);return j;};
await call("POST","/api/admin/subjects/template",{grades:["ป.4"]});
await call("POST","/api/admin/courses/generate",{});
const {courses}=await call("GET","/api/admin/courses");
const mine=courses.filter(c=>c.grade_level==="ป.4"&&c.classroom==="1");
let seed=1;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
for(const c of mine){
  const d=await call("POST",`/api/courses/${c.id}/items`,{items:[{term_number:1,kind:"indicator",title:"ก",max_score:35},{term_number:1,kind:"final",title:"ส",max_score:15},{term_number:2,kind:"indicator",title:"ก",max_score:35},{term_number:2,kind:"final",title:"ส",max_score:15}]});
  if(!d)continue;
  const st=d.students.filter(s=>s.enrollment_status==="enrolled");
  const changes=st.flatMap((s,k)=>d.items.map(it=>({item_id:it.id,student_id:s.id,score:k===0?it.max_score:k===1?it.max_score:Math.floor(it.max_score*(0.5+rnd()*0.5))})));
  await call("PUT",`/api/courses/${c.id}/scores`,{changes});
}
const s=await call("GET","/api/reports/summary");
const p4=s.ranking.find(g=>g.grade_level==="ป.4");
assert.deepEqual(p4.top.map(x=>x.rank),[1,1,3]);
assert.equal(p4.top[0].gpa,4); assert.ok(p4.top[2].gpa<4);
assert.equal(p4.unranked,0);
const p6=s.ranking.find(g=>g.grade_level==="ป.6"); if(p6){assert.equal(p6.top.length,0);}
});
