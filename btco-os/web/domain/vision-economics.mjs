// Port of AcquisitionEconomics.swift. All displayed fees are editable assumptions.
export const defaultEconomics=()=>({budget:10000,itemLimit:10000,committed:0,purchaseTaxPercent:0,minimumProfit:1,minimumMarginPercent:0,minimumROIPercent:0,requireSoldEvidence:true,collectorMode:false,maximumValuePremiumPercent:0,channels:[{id:'eBay',enabled:true,configured:true,feePercent:15,promotionPercent:5,fixedFee:0,feeOnShipping:true,promotionOnShipping:true,buyerShipping:0,postage:100,supplies:25,otherCosts:0},{id:'CollX',enabled:false,configured:false,feePercent:0,promotionPercent:0,fixedFee:0,feeOnShipping:true,promotionOnShipping:true,buyerShipping:0,postage:0,supplies:0,otherCosts:0},{id:'Whatnot',enabled:false,configured:false,feePercent:0,promotionPercent:0,fixedFee:0,feeOnShipping:true,promotionOnShipping:true,buyerShipping:0,postage:0,supplies:0,otherCosts:0}]});
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const amount=n=>Number.isSafeInteger(n)&&n>=0;
export function evaluatePurchase(settings,input){
  const pending=reason=>({signal:'yellow',reason,channels:[]});
  if(!settings||!['budget','itemLimit','committed','minimumProfit'].every(k=>amount(settings[k]))||!['purchaseTaxPercent','minimumMarginPercent','minimumROIPercent','maximumValuePremiumPercent'].every(k=>valid(settings[k])))return pending('Check the budget and target settings.');
  if(!['price','incoming','extra'].every(k=>amount(input[k])))return pending('Enter the asking price and acquisition costs.');
  const cost=Math.round(input.price*(1+settings.purchaseTaxPercent/100))+input.incoming+input.extra;
  const remaining=Math.max(0,settings.budget-settings.committed);
  if(cost>remaining||cost>settings.itemLimit)return {signal:'red',reason:'Over the remaining budget or per-item limit.',cost,remaining,channels:[]};
  if(!amount(input.value)||input.value<=0||!input.identityChecked)return {...pending('Confirm exact identity, condition and expected resale value.'),cost,remaining};
  if(settings.requireSoldEvidence&&!input.soldEvidence)return {...pending('Matching sold evidence needs confirmation. Active listings do not qualify.'),cost,remaining};
  if(settings.collectorMode){const green=cost<=Math.floor(input.value*(1+settings.maximumValuePremiumPercent/100));return {signal:green?'green':'red',reason:green?'Within budget and the configured fair-value limit.':'Above the configured fair-value limit.',cost,remaining,channels:[]};}
  const selected=settings.channels?.filter(c=>c.enabled)??[];
  if(!selected.length||selected.some(c=>!c.configured||!['fixedFee','buyerShipping','postage','supplies','otherCosts'].every(k=>amount(c[k]))||!['feePercent','promotionPercent'].every(k=>valid(c[k])&&c[k]<=100)))return {...pending('Configure costs for every enabled selling channel.'),cost,remaining};
  if(selected.some(c=>c.id==='eBay'&&c.promotionPercent<5))return {...pending('BTCo evaluations require at least 5% eBay promotion.'),cost,remaining};
  const channels=selected.map(c=>{const revenue=input.value+c.buyerShipping;const fee=Math.round((input.value+(c.feeOnShipping?c.buyerShipping:0))*c.feePercent/100);const promotion=Math.round((input.value+(c.promotionOnShipping?c.buyerShipping:0))*c.promotionPercent/100);const net=revenue-cost-fee-promotion-c.fixedFee-c.postage-c.supplies-c.otherCosts;const margin=100*net/revenue;const roi=cost?100*net/cost:null;return {id:c.id,net,margin,roi,qualifies:net>=settings.minimumProfit&&margin>=settings.minimumMarginPercent&&(cost?roi>=settings.minimumROIPercent:net>=0)};});
  const green=channels.some(c=>c.qualifies);return {signal:green?'green':'red',reason:green?'At least one configured channel meets your targets.':'No enabled channel meets your targets.',cost,remaining,channels};
}
