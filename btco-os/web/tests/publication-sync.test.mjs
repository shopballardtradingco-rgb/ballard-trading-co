import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyState,makeItem} from '../domain/core.mjs';
import {verifyPublicationReceipt,reconcilePublication} from '../domain/publication-receipt.mjs';
import {refreshFromListings} from '../domain/ebay-api-refresh.mjs';

export const fixture=JSON.parse(await readFile(new URL('./publication-receipt.fixture.json',import.meta.url),'utf8'));
export const options={publicKeyB64:fixture.publicKeyB64,sellerId:'test-seller',now:Date.parse('2026-10-12T21:00:00Z')};
export const fixtureReceipt=JSON.parse(Buffer.from(fixture.envelope.payload_b64,'base64'));
export async function signed(receipt){
  const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const publicKey=Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey));
  const payload=Buffer.from(JSON.stringify(receipt)),message=Buffer.concat([Buffer.from('BTCo publication receipt v1\0'),payload]);
  const signature=await crypto.subtle.sign('Ed25519',pair.privateKey,message);
  const keyId=Buffer.from(await crypto.subtle.digest('SHA-256',publicKey)).toString('hex');
  return {options:{...options,publicKeyB64:publicKey.toString('base64')},envelope:{schema:'btco.signed-publication.v1',algorithm:'Ed25519',key_id:keyId,payload_b64:payload.toString('base64'),signature_b64:Buffer.from(signature).toString('base64')}};
}
const verified=await verifyPublicationReceipt(fixture.envelope,options);
const withReceipt=async patch=>{const s=await signed({...fixtureReceipt,...patch});return verifyPublicationReceipt(s.envelope,s.options);};

test('Python-signed receipt verifies in WebCrypto; tampering and another seller fail',async()=>{
  assert.equal(verified.receipt.title,'Synthetic comic — test only');
  await assert.rejects(verifyPublicationReceipt(fixture.envelope,{...options,sellerId:'wrong'}),/seller/);
  const tampered={...fixture.envelope,payload_b64:Buffer.from(JSON.stringify({...fixtureReceipt,price_usd:'9'})).toString('base64')};
  await assert.rejects(verifyPublicationReceipt(tampered,options),/signature/);
  await assert.rejects(verifyPublicationReceipt({...fixture.envelope,key_id:'0'.repeat(64)},options),/not trusted/);
  await assert.rejects(verifyPublicationReceipt({...fixture.envelope,signature_b64:'x'.repeat(89)},options),/encoding/);
});

test('signed but invalid prices, URLs, timestamps and promotion claims are rejected',async()=>{
  for(const patch of [{price_usd:'8.99'},{price_usd:'1e1'},{currency:'EUR'},{url:'https://evil.test/999000000001'},{verified_at:'2099-01-01T00:00:00Z'},{promotion:{status:'verified',requested_percent:4}},{master_sku:''}])await assert.rejects(withReceipt(patch));
});

test('new listing creates a review record without claiming physical stock; replay is inert',()=>{
  const state=emptyState(),original=structuredClone(state),result=reconcilePublication(state,verified);
  assert.deepEqual(state,original);assert.equal(result.next.items.length,1);
  const item=result.next.items[0];assert.equal(item.quantity,0);assert.equal(item.availability,'review');assert.equal(item.verification,'unverified');assert.equal(item.costCents,null);assert.equal(item.source.cdpSku,undefined);
  assert.equal(item.listingPrices.ebay.priceCents,800);assert.equal(result.next.sales.length,0);
  const replay=reconcilePublication(result.next,verified);assert.equal(replay.next,result.next);assert.equal(replay.replayed,true);
});

test('exact physical/CDP match preserves literal SKU, stock, costs and other marketplace identity',async()=>{
  const state=emptyState();state.items.push(makeItem({id:'test-comic-1',sku:'Warehouse-1',kind:'comic',title:'Owned comic',quantity:2,costCents:300,channel:'CollX',externalId:'collx-original',source:{cdpId:'cdp-1',cdpSku:' Master-X '},listingPrices:{collx:{priceCents:600,asOf:'2026-10-12',source:'CollX CSV'}}}));
  const v=await withReceipt({master_sku:' Master-X ',listing_sku:' Master-X '}),result=reconcilePublication(state,v),item=result.next.items[0];
  assert.equal(item.quantity,2);assert.equal(item.costCents,300);assert.equal(item.source.cdpSku,' Master-X ');assert.equal(item.sku,'Warehouse-1');assert.equal(item.channel,'CollX');assert.equal(item.externalId,'collx-original');assert.deepEqual(item.listingPrices.collx,state.items[0].listingPrices.collx);
  const snapshot={checksum:'b'.repeat(64),seller:'ballardtradingco',sellerId:'test-seller',total:1,pageCount:1,asOf:'2026-10-12',observedAt:'2026-10-12T21:01:00Z',finishedAt:'2026-10-12T21:01:00Z',records:[{itemId:fixtureReceipt.item_id,sku:' Master-X ',title:fixtureReceipt.title,listingType:'FixedPriceItem',quantity:1,priceCents:800,variationReview:false}]};
  const refresh=refreshFromListings(result.next,snapshot);assert.equal(refresh.next.items.length,1);assert.equal(refresh.summary.matched,1);assert.equal(refresh.summary.added,0);assert.equal(refresh.next.items[0].quantity,2);assert.equal(refresh.summary.quantityConflicts,1);assert.equal(refresh.summary.skuConflicts,0);
  await assert.rejects(async()=>reconcilePublication(state,await withReceipt({master_sku:'master-x'})),/CDP/);
  await assert.rejects(async()=>reconcilePublication(emptyState(),v),/existing/);
});

test('conflicting SKU, physical mapping, raw/graded identity and repeat publication are blocked',async()=>{
  const state=emptyState();state.items.push(makeItem({id:'other',sku:'TEST-ONLY-1',kind:'comic',title:'Other comic'}));
  assert.throws(()=>reconcilePublication(state,verified),/SKU/);
  state.items[0].id='test-comic-1';state.items[0].gradeCompany='CGC';assert.throws(()=>reconcilePublication(state,verified),/raw\/graded/);
  state.items[0].gradeCompany='';state.items[0].channel='eBay';state.items[0].externalId='999000000002';assert.throws(()=>reconcilePublication(state,verified),/relisting/);
  const saved=reconcilePublication(emptyState(),verified).next;
  assert.throws(()=>reconcilePublication(saved,{...verified,checksum:'f'.repeat(64),receipt:{...fixtureReceipt,revision:'b'.repeat(64)}}),/conflicts/);
});

test('newer or manually recorded prices are preserved alongside historical publication evidence',()=>{
  for(const price of [{priceCents:1200,asOf:'2026-10-12',source:'Manually recorded in Vault'},{priceCents:1000,asOf:'2026-10-13',source:'eBay active-listings API'}]){
    const state=emptyState();state.items.push(makeItem({id:'test-comic-1',sku:'TEST-ONLY-1',title:'Owned comic',kind:'comic',listingPrices:{ebay:price}}));
    const result=reconcilePublication(state,verified);assert.equal(result.summary.pricePreserved,true);assert.deepEqual(result.next.items[0].listingPrices.ebay,price);
  }
});

const physicalConfirmation={quantity:1,location:'TEST-BOX / Section 4',owner_evidence:'Owner supplied original photos and confirmed this copy and location.'};
test('explicit owner confirmation creates one permanent physical record; receipt alone never does',()=>{
  const state=emptyState(),result=reconcilePublication(state,verified,{physicalConfirmation}),item=result.next.items[0];
  assert.equal(state.items.length,0);assert.equal(item.id,fixtureReceipt.physical_item_id);
  assert.equal(item.quantity,1);assert.equal(item.availability,'tracked');assert.equal(item.location,physicalConfirmation.location);
  assert.equal(item.costCents,null);assert.equal(item.source.cdpSku,undefined);assert.equal(result.summary.physicalStockChanged,true);
  assert.match(item.notes,/Interior.*unverified/);assert.deepEqual(result.next.events[0].detail.physicalConfirmation,physicalConfirmation);
  assert.equal(reconcilePublication(result.next,verified,{physicalConfirmation}).next,result.next);
  assert.throws(()=>reconcilePublication(result.next,verified,{physicalConfirmation:{...physicalConfirmation,location:'Elsewhere'}}),/differs/);
  for(const value of [null,{}, {...physicalConfirmation,quantity:2},{...physicalConfirmation,location:' '},{...physicalConfirmation,itemId:'other'}])assert.throws(()=>reconcilePublication(state,verified,{physicalConfirmation:value}),/Confirm/);
});
test('owner location input preserves existing stock, financials and CDP identity; conflicting moves fail',async()=>{
  const state=emptyState();state.items.push(makeItem({id:'test-comic-1',sku:'Warehouse-1',title:'Existing',kind:'comic',quantity:2,costCents:300,source:{cdpId:'cdp-1',cdpSku:' Master-X '}}));
  const v=await withReceipt({master_sku:' Master-X ',listing_sku:' Master-X '}),result=reconcilePublication(state,v,{physicalConfirmation}),item=result.next.items[0];
  assert.equal(item.quantity,2);assert.equal(item.costCents,300);assert.equal(item.sku,'Warehouse-1');assert.equal(item.source.cdpSku,' Master-X ');assert.equal(item.location,physicalConfirmation.location);assert.equal(result.summary.physicalStockChanged,false);
  state.items[0].location='ORIGINAL';assert.throws(()=>reconcilePublication(state,v,{physicalConfirmation}),/location differs/);assert.equal(state.items[0].location,'ORIGINAL');
});
