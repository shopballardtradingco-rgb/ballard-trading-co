// Owner's reported postage baseline, not a live label quote or buyer shipping charge.
export const PWE_LABEL_BASELINE_CENTS=78;
export const isCardLot=d=>d.shippingMode==='lot'||/\b(lot|bundle)\b|\bset of\s+\d|\b\d+\s*[- ]card\s+(set|lot)\b/i.test(d.title??'');
export function shippingRoute(d){
 if(d.kind!=='card')return 'review';
 if(isCardLot(d))return 'lot';
 if(d.shippingMode==='review')return 'review';
 if(d.gradeCompany)return 'graded';
 if(d.shippingMode==='parcel')return 'parcel';
 if(!Number.isSafeInteger(d.askCents)||d.askCents<100)return 'review';
 return d.askCents<=2000?'raw':'high';
}
export const routeLabels={raw:'PWE · $20 or less · $0.78 owner cost baseline',high:'Over $20 · parcel shipping',graded:'Graded card · protective parcel',parcel:'Parcel shipping override',lot:'Card lot · review packed weight and shipping cost',review:'Review packed weight and shipping cost'};
export function conditionChoices(d){
 const values=d.kind==='comic'?['Like New','Very Good','Good','Acceptable']:d.gradeCompany?['Graded']:['Near mint or better','Excellent','Very good','Poor'];
 const aliases={nm:'Near mint or better','near mint':'Near mint or better',ex:'Excellent',vg:'Very good'};
 const current=String(d.condition??''),match=values.find(v=>v.toLowerCase()===current.toLowerCase())??(values.includes(aliases[current.toLowerCase()])?aliases[current.toLowerCase()]:undefined);
 // Old assessments stay in the record, never in the selectable eBay vocabulary.
 return {values,value:match??'',legacy:current&&!match?current:null};
}

export function checkedCondition(d,value){
 const choices=conditionChoices({...d,condition:''});
 if(typeof value!=='string'||!choices.values.includes(value))throw Error('Choose an eBay condition from the dropdown. Legacy grades and free text are not listing conditions.');
 return value;
}
export function sharedConditionChoices(drafts){
 if(!drafts.length)return [];
 return conditionChoices({...drafts[0],condition:''}).values.filter(v=>drafts.every(d=>conditionChoices({...d,condition:''}).values.includes(v)));
}
