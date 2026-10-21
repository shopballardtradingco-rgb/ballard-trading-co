import {intakeRecords} from './intake-contract.mjs';
import {previewImport,mergeImport} from './core.mjs';
const stable=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function deviceMerge(shared,local,baseline){
  const plan=previewImport(shared,local),accepted=new Set(plan.accepted.map(i=>i.id));
  const current=new Map(shared.items.map(i=>[i.id,i])),base=new Map(baseline.items.map(i=>[i.id,i])),conflicts=[];
  for(const item of local.items){
    if(accepted.has(item.id))continue;
    const remote=current.get(item.id);
    const newSales=local.sales.filter(s=>s.itemId===item.id&&!shared.sales.some(r=>r.id===s.id&&stable(r)===stable(s)));
    if((stable(item)!==stable(base.get(item.id))&&stable(item)!==stable(remote))||newSales.length)conflicts.push({id:item.id,sku:item.sku,title:item.title,local:item,shared:remote??null,localSales:newSales.length});
  }
  const sharedIntakes=new Map(intakeRecords(shared).map(r=>[r.id,r]));
  for(const draft of intakeRecords(local)){
    const remote=sharedIntakes.get(draft.id);
    if(remote&&stable(remote)!==stable(draft))conflicts.push({id:draft.id,sku:'Intake draft',title:draft.title,kind:'intake',local:draft,shared:remote,localSales:0});
  }
  const added=plan.accepted.length+plan.acceptedIntakes.length;
  return {next:added?mergeImport(shared,local):shared,added,conflicts};
}
