import { createInitialData } from '../src/lib/defaults';
import { dayAvailability, calendarLoadFor } from '../src/lib/calendar/availability';
import { suggestSlots, conflictsFor, proposeSchedule, verdictFor } from '../src/lib/calendar/scheduler';
import { runSync, connectRecord, disconnectRecord, MemoryGoogleAdapter, eventKey, SYNC_RETRY_LIMIT, externalConnectState, connectionStatusLabel } from '../src/lib/calendar/provider';
import { planningOf, capacityMinutesOf, workWindowOf } from '../src/lib/calendar/time';
import type { AppData, ExternalSyncEvent } from '../src/lib/types';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const days = (n:number) => iso(new Date(Date.now()+n*86400000));
const T = days(0);
function data(): AppData {
  const d = createInitialData();
  return { ...d, onboarded: true, settings: { ...d.settings, name:'T' } };
}
let pass=0, fail=0;
const ok=(c:boolean,m:string)=>{ if(c){pass++;} else {fail++; console.log('FAIL', m);} };

// capacity default 480
ok(capacityMinutesOf() === 480, 'default capacity 480');
const p = planningOf(); ok(p.workStart==='09:00' && p.breakEnd==='14:00','defaults 9-18 break 13-14');
const w = workWindowOf(); ok(w.start===540 && w.end===1080 && w.breakFrom===780 && w.breakTo===840,'window mins');

// availability: external event 10-11 + task 10:30-11:30 → merged busy 10-11:30
const d = data();
d.calendarEvents = [{ key:'g:w:e1', provider:'google', calendarId:'w', externalId:'e1', title:'Standup', start:`${T}T10:00:00`, end:`${T}T11:00:00`, updatedAt:'x' }];
d.tasks = [{ id:'t1', text:'Deep work', done:false, date:T, start:'10:30', minutes:60, createdAt:'x', rescheduledAt:[] }];
d.habits = [{ id:'h1', name:'Run', icon:'🏃', color:'#333', daysOfWeek:[], active:true, createdAt:T, minutes:30 }];
const a = dayAvailability(d, T);
ok(a.extMin===60, `ext 60 got ${a.extMin}`);
ok(a.plannedTaskMin===60,'planned 60');
ok(a.habitMin===30,'habit 30');
ok(a.busyMin===90,'merged busy 90 (10:00-11:30)');
ok(a.freeMin===390,'free 390 (480-90)');
ok(a.blocks.some(b=>b.kind==='break'),'break block present');
ok(calendarLoadFor(d,T).level==='light','load light (150 of 480)');

// free windows order: 09:00-10:00, 11:30-13:00, 14:00-18:00
ok(a.windows.length===3 && a.windows[0].from===540 && a.windows[0].to===600,'first window 9-10');
ok(a.windows[1].from===690 && a.windows[1].to===780,'second 11:30-13');
ok(a.windows[2].from===840 && a.windows[2].to===1080,'third 14-18');

// suggestion for 60m tomorrow (after today) → earliest tomorrow 09:00; why includes free
const sug = suggestSlots(d, { minutes:60, priority:1 }, T, 9*60);
ok(sug.length>=1 && sug[0].date===T && sug[0].startMin===540,`first suggestion today 09:00 got ${JSON.stringify(sug[0] && {date:sug[0].date, s:sug[0].startMin})}`);
ok(sug[0].why.some(x=>x.includes('high-priority')), 'why mentions priority');
ok(sug[0].why.some(x=>x.includes('free')),'why mentions free');

// conflict detection
const cf = conflictsFor(d, T, '10:15', 60);
ok(cf.length===1 && cf[0].kind==='external', `conflict ext got ${cf.length}`);
const cf2 = conflictsFor(d, T, '13:30', 60);
ok(cf2.length===1 && cf2[0].kind==='break','break conflict');
const cf3 = conflictsFor(d, T, '16:00', 60);
ok(cf3.length===0,'no conflict at 16');
const cf4 = conflictsFor(d, T, '08:00', 30);
ok(cf4.some(c=>c.kind==='outside-hours'),'outside hours');

// verdict copy
const v = verdictFor(d, T); ok(v.text.includes('planned') && (v.tone==='ok'||v.tone==='full'),'verdict sane');

// proposal: two unscheduled tasks → both placed, deterministic
const d2 = data();
d2.tasks = [ {id:'p1',text:'B',done:false,createdAt:'2026-09-01T00:00:00',rescheduledAt:[]},
             {id:'p2',text:'A',done:false,createdAt:'2026-09-01T00:00:01',rescheduledAt:[]} ];
const pp = proposeSchedule(d2, d2.tasks, { after:T });
ok(pp.rows.length===2 && pp.unplaced.length===0,'proposal places both');
if (!(pp.rows[0].startMin===540 && pp.rows[1].startMin===540+60)) console.log('dbg proposal', JSON.stringify(pp.rows.map(r=>({id:r.taskId,s:r.startMin,e:r.endMin}))));
ok(pp.rows[0].startMin===540 && pp.rows[1].startMin===540+60,'sequential fit');

// provider sync: dedupe + selection + removal
const mocks = [ { id:'work', name:'Work', events: [
  { externalId:'ev1', calendarId:'work', title:'Meeting', start:`${T}T10:00:00`, end:`${T}T11:00:00`, updatedAt:'2026-01-01T00:00:00Z' },
  { externalId:'ev2', calendarId:'work', title:'Focus', start:`${T}T14:00:00`, end:`${T}T15:00:00`, updatedAt:'2026-01-01T00:00:00Z' },
] as ExternalSyncEvent[] } ];
const conn0 = { provider:'google' as const, status:'connected' as const, retryCount:0, selectedCalendarIds:['work'], writeEnabled:false };
const adapter = new MemoryGoogleAdapter(mocks);
const out1 = await runSync(conn0, adapter, []);
ok(out1.connection.status==='connected' && out1.connection.lastSyncedAt, 'sync ok');
ok(out1.events.length===2,'two events synced');
ok(out1.events.every(e=>e.key.startsWith('google:work:')),'dedupe keys');
// incremental: same adapter returns 1 event only (deleted one) → removal detected
mocks[0].events.pop();
const out2 = await runSync(out1.connection, adapter, out1.events);
if (!(out2.removedKeys.length===1 && out2.events.length===1)) console.log('dbg removal', JSON.stringify({removed:out2.removedKeys, events:out2.events.map(e=>e.externalId)}));
ok(out2.removedKeys.length===1 && out2.events.length===1,'removal detected');
// selection filtering
mocks[0].events = [ { externalId:'ev3', calendarId:'home', title:'Private', start:`${T}T09:00:00`, end:`${T}T09:30:00`, updatedAt:'x' } as ExternalSyncEvent ];
const out3 = await runSync({...out1.connection, selectedCalendarIds:['work']}, adapter, out2.events);
ok(out3.events.filter(e=>e.provider==='google').every(e=>e.calendarId==='work'),'calendar selection honored');
// retry & needs-attention
const failing = new MemoryGoogleAdapter([], true);
const out4 = await runSync(conn0, failing, []);
ok(out4.error && out4.connection.status==='needs-attention' && out4.connection.syncError?.includes('attention'), 'failure label user-safe');
ok(out4.connection.syncError!.toLowerCase().includes('oauth')===false,'no raw error leak');
// connect/disconnect data untouched
const dc = connectRecord({ data:d, provider:'google', accountEmail:'j@x.dev', calendars:[{id:'work',name:'Work'}], selectedCalendarIds:['work'] });
ok((dc.calendarConnections??[]).length===1 && dc.tasks?.length===1,'connect record keeps doc');
const dd = disconnectRecord(dc, 'google', false);
ok((dd.calendarConnections??[]).length===0 && (dd.calendarEvents??[]).length===1 && dd.tasks?.length===1,'disconnect keeps doc + cached');
ok(externalConnectState('google').ok===false && (externalConnectState('google').reason??'').length>0,'static build gate honest');
ok(connectionStatusLabel(undefined).label==='Not connected','status label');
ok(eventKey('google','w','e')==='google:w:e','event key');
console.log(`engine check: ${pass} passed, ${fail} failed`);
if (fail>0) process.exit(1);
