import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { makeEnv } from '../dev/server.mjs';
import { PASSWORD } from '../dev/seed.mjs';
import { CALENDAR_TYPES } from '../src/lib/calendar-types.js';
import { ensureSchema, SCHEMA_VERSION } from '../src/lib/schema.js';
import { logColumns, sheetForMonth } from '../public/js/logbook-data.js';

const Q = `grade=${encodeURIComponent('ป.4')}&room=1`;
async function setup() {
  const env = await makeEnv(), cookies = {};
  async function call(who, method, path, body, status = 200) {
    const res = await worker.fetch(new Request(`http://school.test${path}`, { method,
      headers: { 'Content-Type': 'application/json', Origin: 'http://school.test', ...(cookies[who] ? { Cookie: cookies[who] } : {}) },
      body: body ? JSON.stringify(body) : undefined }), env);
    const data = await res.json();
    assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  for (const [who, email] of [['admin','admin@test.local'],['teacher','teacher1@test.local']]) {
    const r = await worker.fetch(new Request('http://school.test/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password:PASSWORD}) }),env);
    cookies[who] = r.headers.get('Set-Cookie').split(';')[0];
  }
  await call('admin','POST','/api/admin/import/homerooms',{rows:[{room:'ป.4/1',teachers:'ครูสมใจ ใจดี'}]});
  const sid = (await call('teacher','GET',`/api/homeroom?${Q}`)).students[0].id;
  const calendar = () => call('teacher','GET','/api/calendar');
  const attendance = () => call('teacher','GET',`/api/homeroom/attendance?${Q}&month=2026-11`);
  const logs = () => call('teacher','GET',`/api/homeroom/logs?${Q}&type=milk&month=2026-11`);
  return {env,call,sid,calendar,attendance,logs};
}

test('all seven categories: only the five holiday categories close school and clear records',async()=>{
  const {call,sid,calendar,attendance,logs,env}=await setup();
  const base=await calendar();
  assert.deepEqual(base.types,CALENDAR_TYPES);
  const dates=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-09','2026-11-10'];
  for(let i=0;i<CALENDAR_TYPES.length;i++){
    const t=CALENDAR_TYPES[i],date=dates[i];
    await call('teacher','PUT',`/api/homeroom/attendance?${Q}`,{changes:[{student_id:sid,date,code:'ข'}]});
    await call('teacher','PUT',`/api/homeroom/logs?${Q}`,{changes:[{student_id:sid,date,type:'milk',value:'1'}]});
    const beforeReport=await call('teacher','GET',`/api/reports/room?${Q}`);
    await call('admin','POST','/api/calendar',{from:date,name:t.label,category:t.value,description:'เวลา 09.00 น.\nผู้รับผิดชอบ: ฝ่ายวิชาการ',is_holiday:!t.is_holiday});
    const c=await calendar(),a=await attendance(),l=await logs();
    assert.equal(a.days.includes(date),!t.is_holiday);
    assert.equal(l.days.includes(date),!t.is_holiday);
    assert.equal(c.holidays.some(h=>h.holiday_date===date),t.is_holiday);
    const entry=t.is_holiday?c.holidays.find(h=>h.holiday_date===date):c.events.find(e=>e.event_date===date);
    assert.equal(entry.category,t.value);assert.match(entry.description,/ผู้รับผิดชอบ/);
    const columns=logColumns(l),col=columns.find(x=>x.date===date);
    assert.equal(!!col.off,t.is_holiday);
    const excel=JSON.stringify(sheetForMonth(l));
    if(t.is_holiday){
      assert.equal(a.records[sid]?.[date],undefined);assert.equal(l.records[sid]?.milk?.[date],undefined);
      assert.match(excel,new RegExp(t.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
      await call('teacher','PUT',`/api/homeroom/attendance?${Q}`,{changes:[{student_id:sid,date,code:'ข'}]},400);
    }else{
      assert.equal(a.records[sid][date],'ข');assert.equal(l.records[sid].milk[date],'1');
      assert.ok(!JSON.stringify(l).includes(t.label));assert.ok(!excel.includes(t.label));
      assert.deepEqual(await call('teacher','GET',`/api/reports/room?${Q}`),beforeReport,'ปพ.6 unchanged');
    }
  }
  assert.equal((await calendar()).school_days,base.school_days-5);
  // Shared consumers (including the school dashboard) still see holidays only.
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM gr_holidays WHERE holiday_date IN ('2026-11-06','2026-11-09')").first()).n,0);
});

test('events overlap holidays/each other, include weekends, and edit/delete/convert without leaking to records',async()=>{
  const {call,sid,calendar,attendance,logs}=await setup();
  const date='2026-11-03',original=(await calendar()).school_days;
  await call('teacher','PUT',`/api/homeroom/attendance?${Q}`,{changes:[{student_id:sid,date,code:'ป'}]});
  await call('admin','POST','/api/calendar',{from:date,to:'2026-11-08',name:'เทศกาล',category:'festival'});
  assert.equal((await calendar()).events.length,6);
  await call('admin','POST','/api/calendar',{from:date,name:'งานโรงเรียน',category:'school_activity'});
  let c=await calendar(),e=c.events.find(e=>e.name==='งานโรงเรียน');
  assert.equal(c.school_days,original);assert.equal((await attendance()).records[sid][date],'ป');
  await call('teacher','POST','/api/calendar',{from:date,name:'ไม่มีสิทธิ์',category:'festival'},403);
  await call('teacher','DELETE',`/api/calendar/events/${e.id}`,null,403);
  await call('admin','POST','/api/calendar',{from:date,name:'แก้รายละเอียด',category:'school_activity',description:'รายละเอียดใหม่',event_id:e.id});
  c=await calendar();e=c.events.find(e=>e.name==='แก้รายละเอียด');
  assert.equal(c.events.filter(e=>e.event_date===date).length,2);
  assert.equal((await attendance()).records[sid][date],'ป');
  await call('admin','POST','/api/calendar',{from:date,name:'หยุดกิจกรรม',category:'school_activity_holiday',event_id:e.id});
  c=await calendar();assert.equal(c.school_days,original-1);assert.equal(c.events.filter(e=>e.event_date===date).length,1);
  assert.equal((await attendance()).records[sid]?.[date],undefined);
  assert.equal(logColumns(await logs()).find(x=>x.date===date).off,'หยุดกิจกรรม');
  await call('admin','POST','/api/calendar',{from:date,name:'กิจกรรมเปิดเรียน',category:'school_activity',replace_holiday:true});
  assert.equal((await calendar()).school_days,original);
  assert.equal(logColumns(await logs()).find(x=>x.date===date).off,null);
  c=await calendar();e=c.events.find(e=>e.name==='กิจกรรมเปิดเรียน');
  await call('admin','DELETE',`/api/calendar/events/${e.id}`);
  assert.ok(!(await calendar()).events.some(x=>x.id===e.id));
  assert.equal((await calendar()).school_days,original);
  await call('admin','POST','/api/calendar',{from:date,name:'เก่า',category:'festival',event_id:e.id},404);
  // Legacy clients still create actual holidays.
  await call('admin','POST','/api/calendar',{from:date,name:'วันหยุดแบบเดิม'});
  assert.equal((await calendar()).holidays.find(h=>h.holiday_date===date).category,'holiday');
});

test('invalid categories, dates and event edits are rejected atomically; backup includes both kinds',async()=>{
  const {call,calendar}=await setup();const before=await calendar();
  for(const b of [
    {from:'2026-02-30',name:'ไม่จริง'}, {from:'2026-11-03',name:'x',category:'bogus'},
    {from:'2026-11-03',name:'x',category:'festival',event_id:'1'},
    {from:'2026-11-03',to:'2027-11-03',name:'ยาว',category:'festival'},
    {from:'2026-11-03',to:'2027-03-03',name:'เกิน120วัน',category:'festival'},
  ]) await call('admin','POST','/api/calendar',b,400);
  await call('admin','POST','/api/calendar',{from:'2026-11-03',name:'เปลี่ยนรายการที่หาย',category:'festival',replace_holiday:true},409);
  assert.deepEqual(await calendar(),before);
  const backup=await call('admin','GET','/api/backup/tables');
  assert.ok(backup.tables.some(t=>t.name==='gr_calendar_events'));
  assert.ok(backup.tables.find(t=>t.name==='gr_holidays').columns.includes('category'));
});

test('gr-23 database upgrades preserve old holidays and classify government seeds; upgrade is repeatable',async()=>{
  const env=await makeEnv(); await ensureSchema(env);
  await env.DB.prepare('DROP TABLE gr_holidays').run();
  await env.DB.prepare(`CREATE TABLE gr_holidays(academic_year_id INTEGER,holiday_date TEXT,name TEXT NOT NULL,created_by INTEGER,created_at TEXT DEFAULT (datetime('now')),PRIMARY KEY(academic_year_id,holiday_date))`).run();
  await env.DB.prepare("INSERT INTO gr_holidays(academic_year_id,holiday_date,name) VALUES(1,'2026-11-03','เดิม'),(1,'2026-12-05','ราชการเดิม')").run();
  await env.DB.prepare("INSERT OR REPLACE INTO gr_holiday_seeds(academic_year_id,holiday_date,name) VALUES(1,'2026-12-05','ราชการเดิม')").run();
  await env.DB.prepare("INSERT OR REPLACE INTO system_settings(setting_key,setting_value) VALUES('students_report_schema','gr-23')").run();
  const fresh={...env,DB:{...env.DB}};await ensureSchema(fresh);
  const rows=(await fresh.DB.prepare('SELECT holiday_date,name,category,description FROM gr_holidays ORDER BY holiday_date').all()).results;
  assert.deepEqual(rows,[{holiday_date:'2026-11-03',name:'เดิม',category:'holiday',description:''},{holiday_date:'2026-12-05',name:'ราชการเดิม',category:'government',description:''}]);
  assert.equal((await fresh.DB.prepare("SELECT setting_value FROM system_settings WHERE setting_key='students_report_schema'").first()).setting_value,SCHEMA_VERSION);
  await ensureSchema({...env,DB:{...env.DB}});
  assert.deepEqual((await fresh.DB.prepare('SELECT holiday_date,name,category,description FROM gr_holidays ORDER BY holiday_date').all()).results,rows);
});

test('converting an event to a holiday rolls back the event and records if any write fails',async()=>{
  const {call,calendar,env,sid,attendance}=await setup(),date='2026-11-03';
  await call('admin','POST','/api/calendar',{from:date,name:'คงเดิม',category:'school_activity'});
  const before=await calendar(),event=before.events[0];
  await call('teacher','PUT',`/api/homeroom/attendance?${Q}`,{changes:[{student_id:sid,date,code:'ข'}]});
  await env.DB.prepare(`CREATE TRIGGER fail_test BEFORE DELETE ON gr_attendance WHEN OLD.att_date='2026-11-03' BEGIN SELECT RAISE(ABORT,'test rollback'); END`).run();
  await call('admin','POST','/api/calendar',{from:date,name:'ต้องย้อนกลับ',category:'holiday',event_id:event.id},500);
  assert.deepEqual(await calendar(),before);
  assert.equal((await attendance()).records[sid][date],'ข');
});
