import {providerError,SCAN_RESERVE_MICROS} from './vision-provider.mjs';
export const operationIdValid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(id);
export const dayKey=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export function visionLimits(env){
  const scans=env.VISION_DAILY_SCAN_LIMIT??'20',budget=env.VISION_DAILY_BUDGET_USD??'1.00',psa=env.VISION_PSA_DAILY_LIMIT??'90';
  if(!/^\d+$/.test(String(scans))||Number(scans)>500||!/^\d+(\.\d{1,2})?$/.test(String(budget))||Number(budget)>100||!/^\d+$/.test(String(psa))||Number(psa)>90)throw providerError('Vision usage limits need configuration.',503);
  return {scans:Number(scans),budgetMicros:Math.round(Number(budget)*1000000),psa:Number(psa)};
}
export async function usage(db,owner,now,limits){
  const day=dayKey(now),rows=await db.prepare('SELECT kind,COUNT(*) AS attempts,SUM(COALESCE(cost_micros,reserved_micros)) AS committed FROM vision_operations WHERE owner_id=? AND day=? GROUP BY kind').bind(owner,day).all();
  const scan=rows.results.find(x=>x.kind==='scan'),psa=rows.results.find(x=>x.kind==='psa');
  return {day,timezone:'America/Los_Angeles',scanAttempts:scan?.attempts??0,scanLimit:limits.scans,committedMicros:scan?.committed??0,budgetMicros:limits.budgetMicros,psaAttempts:psa?.attempts??0,psaLimit:limits.psa,reservePerScanMicros:SCAN_RESERVE_MICROS};
}
export async function reserve(db,owner,id,kind,hash,now,limits){
  const old=await db.prepare('SELECT * FROM vision_operations WHERE owner_id=? AND id=?').bind(owner,id).first();
  if(old){if(old.request_hash!==hash||old.kind!==kind)throw providerError('This request ID belongs to different photos or a different lookup.',409);if(old.status==='complete')return {result:JSON.parse(old.result),cached:true};throw providerError(old.status==='pending'?'This request is already running or its outcome is uncertain. Refresh recent scans before trying again.':old.error||'This request failed. Start a new request to retry.',409);}
  const amount=kind==='scan'?SCAN_RESERVE_MICROS:0,day=dayKey(now),max=kind==='scan'?limits.scans:limits.psa;
  // One atomic INSERT enforces both count and conservative cost limits across concurrent tabs.
  const result=await db.prepare(`INSERT OR IGNORE INTO vision_operations(owner_id,id,kind,day,request_hash,status,reserved_micros,created_at,updated_at)
    SELECT ?,?,?,?,?, 'pending',?,?,? WHERE
    (SELECT COUNT(*) FROM vision_operations WHERE owner_id=? AND day=? AND kind=?) < ? AND
    (?='psa' OR (SELECT COALESCE(SUM(COALESCE(cost_micros,reserved_micros)),0) FROM vision_operations WHERE owner_id=? AND day=? AND kind='scan') + ? <= ?)`)
    .bind(owner,id,kind,day,hash,amount,now,now,owner,day,kind,max,kind,owner,day,amount,limits.budgetMicros).run();
  if(result.meta.changes!==1)throw providerError('Daily Vision limit reached, or this request is already running. Refresh usage and recent scans.',429);
  return {reserved:true};
}
export async function finish(db,owner,id,result,metrics,now){
  await db.prepare("UPDATE vision_operations SET status='complete',result=?,cost_micros=?,input_tokens=?,output_tokens=?,updated_at=? WHERE owner_id=? AND id=? AND status='pending'").bind(JSON.stringify(result),metrics?.costMicros??null,metrics?.inputTokens??null,metrics?.outputTokens??null,now,owner,id).run();
}
export async function fail(db,owner,id,error,metrics,now){
  await db.prepare("UPDATE vision_operations SET status='failed',error=?,cost_micros=?,input_tokens=?,output_tokens=?,updated_at=? WHERE owner_id=? AND id=? AND status='pending'").bind(error.message,metrics?.costMicros??null,metrics?.inputTokens??null,metrics?.outputTokens??null,now,owner,id).run();
}
