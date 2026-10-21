import {seedFixture,channelFactsFixture} from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyState,makeItem,saveItem,summary,recordSale,validateState,mergeImport,previewImport,inventoryCSV,isEbayOnlyOpen} from '../domain/core.mjs';
import {saveIntakeDraft,linkIntake,intakeRecords,cdpCandidates} from '../domain/vision-intake.mjs';
import {packState,unpackState} from '../domain/sync-pack.mjs';
import {deviceMerge} from '../domain/device-merge.mjs';
import {previewEbayRefresh} from '../domain/ebay-refresh.mjs';
const card={player:'Ken Griffey Jr.',year:'1989',set:'Upper Deck',cardNumber:'1',gradingCompany:'PSA',grade:'9',certificationNumber:'12345678'};
const scan={scanId:'test-scan-123',identifiedAt:'2026-10-12T01:00:00Z',provider:'OpenAI',model:'test-model',card};
const draft=(s=emptyState(),options={})=>saveIntakeDraft(s,card,{evidence:scan,...options});
const options={sku:'CDP-ABC123',reviewed:true,cdpConfirmed:true};
const existing=()=>saveItem(emptyState(),makeItem({id:'existing-card',sku:'marketplace-alias',title:'Existing title',subject:'Ken Griffey Jr.',year:'1989',setName:'Upper Deck',number:'1',costCents:1000,location:'Old shelf',channel:'eBay',externalId:'12345',listingPrices:{ebay:{priceCents:2500,source:'snapshot',asOf:'2026-10-06'}},source:{asOf:'2026-10-06',cdpSku:'CDP-ABC123',cdpId:'source-id'}}));

test('intake draft saves without a SKU or stock count and survives shared packaging',async()=>{
  const original=emptyState(),{next,record}=draft(original);
  assert.equal(original.events.length,0);assert.equal(next.items.length,0);assert.equal(summary(next).units,0);assert.equal(record.status,'draft');assert.equal(record.cdpSku,'');
  const packed=await packState(next),restored=unpackState(packed.manifest,new Map(packed.chunks.map(c=>[c.hash,c.body])));
  assert.deepEqual(intakeRecords(validateState(restored)),[record]);
});
test('saving the same scan updates its draft and preserves original identification',()=>{
  const first=draft(),edited=saveIntakeDraft(first.next,{...card,parallel:'Reviewed parallel'},{evidence:scan,title:'Reviewed title'});
  assert.equal(edited.record.id,first.record.id);assert.equal(intakeRecords(edited.next).length,1);assert.equal(edited.record.card.parallel,'Reviewed parallel');assert.equal(edited.record.evidence.card.parallel,'');assert.equal(edited.next.events.length,2);
});
test('new CDP-linked inventory requires both confirmations and a real CDP SKU; repeat link is blocked',()=>{
  const d=draft();
  for(const patch of [{reviewed:false},{cdpConfirmed:false},{sku:''},{sku:'BT-V-1234ABCD'}])assert.throws(()=>linkIntake(d.next,d.record.id,{...options,...patch}));
  const linked=linkIntake(d.next,d.record.id,options);assert.equal(linked.created,true);assert.equal(linked.item.sku,options.sku);assert.equal(linked.item.cdpLink.sku,options.sku);assert.equal(linked.item.costCents,null);assert.equal(linked.item.verification,'unverified');assert.equal(summary(linked.next).units,1);assert.equal(intakeRecords(linked.next)[0].status,'linked');
  assert.throws(()=>linkIntake(linked.next,d.record.id,options),/already linked/);assert.throws(()=>draft(linked.next),/already linked/);
  assert.match(inventoryCSV(linked.next),/CDP master SKU/);
});
test('CDP alias links the existing item without changing SKU, stock, source, costs, location or prices',()=>{
  const s=existing(),before=structuredClone(s.items[0]),d=draft(s,{costCents:9999,location:'Different proposed shelf'}),linked=linkIntake(d.next,d.record.id,{...options,sku:'cdp-abc123'});
  assert.equal(linked.created,false);assert.equal(linked.next.items.length,1);assert.equal(linked.item.id,before.id);
  const {cdpLink,...preserved}=linked.item;assert.deepEqual(preserved,before);assert.equal(cdpLink.method,'manual-confirmation');assert.equal(cdpCandidates(linked.next,'CDP-ABC123')[0].id,before.id);
  assert.equal(cdpLink.sku,before.source.cdpSku);assert.equal(linked.record.cdpSku,before.source.cdpSku);
  assert.equal(intakeRecords(linked.next)[0].costCents,9999);
});
test('CDP linkage preserves literal master SKU whitespace and case',()=>{
  const s=existing();s.items[0].source.cdpSku=' CDP-Exact ';
  const d=draft(s),linked=linkIntake(d.next,d.record.id,{...options,sku:'cdp-exact'});
  assert.equal(linked.item.cdpLink.sku,' CDP-Exact ');
  assert.equal(linked.record.cdpSku,' CDP-Exact ');
  const fresh=draft(),created=linkIntake(fresh.next,fresh.record.id,{...options,sku:' CDP-New '});
  assert.equal(created.item.sku,' CDP-New ');assert.equal(created.item.cdpLink.sku,' CDP-New ');
});
test('linking a sold or review-held record never restores available stock or changes sales',()=>{
  let s=existing();s=recordSale(s,{itemId:s.items[0].id,quantity:1,date:'2026-10-11',channel:'eBay',reference:'sale',notes:'',revenueCents:2000,shippingCollectedCents:0,sellingFeeCents:0,promoFeeCents:0,postageCents:0,suppliesCents:0,refundCents:0});
  const d=draft(s),linked=linkIntake(d.next,d.record.id,options);assert.equal(summary(linked.next).units,0);assert.deepEqual(linked.next.sales,s.sales);
  const held=existing();held.items[0].availability='review';const hd=draft(held),hl=linkIntake(hd.next,hd.record.id,options);assert.equal(hl.item.availability,'review');assert.equal(summary(hl.next).units,0);
});
test('selected record cannot take another record’s CDP SKU, certificate or scan',()=>{
  const s=saveItem(existing(),makeItem({id:'other-card',sku:'OTHER',title:'Other card',gradeCompany:'PSA',cert:'12345678'})),d=draft(s);
  assert.throws(()=>linkIntake(d.next,d.record.id,{...options,existingItemId:'other-card'}),/different inventory record/);
  assert.throws(()=>linkIntake(d.next,d.record.id,options),/certificate belongs/);
  const different=draft(existing());assert.throws(()=>linkIntake(different.next,different.record.id,{...options,sku:'OTHER',existingItemId:'existing-card'}),/different CDP SKU/);
});
test('a legacy Vision or eBay-only record can be linked without renaming it or adding stock',()=>{
  const s=saveItem(emptyState(),makeItem({id:'legacy',sku:'BT-V-1234ABCD',title:'Existing card',channel:'eBay',externalId:'12345'})),d=draft(s);
  const linked=linkIntake(d.next,d.record.id,{...options,existingItemId:'legacy'});assert.equal(linked.next.items.length,1);assert.equal(linked.item.sku,'BT-V-1234ABCD');assert.equal(linked.item.externalId,'12345');assert.equal(isEbayOnlyOpen(linked.next,linked.item),false);
});
test('similar cards require another-copy confirmation; exact certificates cannot be duplicated',()=>{
  const s=existing(),d=draft(s);assert.throws(()=>linkIntake(d.next,d.record.id,{...options,sku:'CDP-NEW'}),/another physical copy/);
  const linked=linkIntake(d.next,d.record.id,{...options,sku:'CDP-NEW',separateCopy:true});assert.equal(linked.next.items.length,2);
  const again=draft(linked.next,{evidence:{...scan,scanId:'test-scan-other'}});assert.throws(()=>linkIntake(again.next,again.record.id,{...options,sku:'CDP-THIRD',separateCopy:true}),/certificate belongs/);
});
test('draft-only backup import and device migration preserve drafts without creating inventory',()=>{
  const d=draft(),p=previewImport(emptyState(),d.next);assert.equal(p.accepted.length,0);assert.equal(p.acceptedIntakes.length,1);
  const imported=mergeImport(emptyState(),d.next);assert.deepEqual(intakeRecords(imported),[d.record]);assert.equal(imported.items.length,0);
  const merged=deviceMerge(emptyState(),d.next,emptyState());assert.equal(merged.added,1);assert.deepEqual(intakeRecords(merged.next),[d.record]);
  const updated=saveIntakeDraft(d.next,card,{id:d.record.id,title:'Local correction'});assert.equal(deviceMerge(d.next,updated.next,emptyState()).conflicts[0].kind,'intake');
  assert.equal(previewImport(imported,d.next).acceptedIntakes.length,0);
});
test('linked draft backup restores its item together and rejects orphan links or rewritten evidence',()=>{
  const d=draft(),linked=linkIntake(d.next,d.record.id,options),restored=mergeImport(emptyState(),linked.next);
  assert.equal(restored.items.length,1);assert.equal(intakeRecords(restored)[0].linkedItemId,linked.item.id);
  const broken=structuredClone(linked.next);broken.items=[];assert.throws(()=>validateState(broken),/linked intake/);
  const changed=structuredClone(linked.next);changed.events.at(-1).detail.record.evidence.card.player='Rewritten';assert.throws(()=>validateState(changed),/provenance/);
});
test('a real differing CDP and marketplace SKU resolves without changing imported inventory',()=>{
  const s=seedFixture(),item=s.items.find(i=>i.source?.cdpSku&&i.source.cdpSku!==i.sku),before=JSON.stringify(s.items);
  assert.equal(cdpCandidates(s,item.source.cdpSku)[0].id,item.id);assert.equal(cdpCandidates(s,item.sku)[0].id,item.id);assert.equal(JSON.stringify(s.items),before);
});
test('eBay refresh prevents a new listing row duplicating a linked CDP alias',()=>{
  const s=existing(),incoming=emptyState();incoming.items=[makeItem({id:'new-listing',sku:'CDP-ABC123',title:'Same card',channel:'eBay',externalId:'999'})];incoming.importBatches=[{id:'batch',listingAsOf:'2026-10-11',stats:{}}];
  const plan=previewEbayRefresh(s,incoming,{checksum:'a'.repeat(64)});assert.equal(plan.added.length,0);assert.equal(plan.blocked.length,1);
});
