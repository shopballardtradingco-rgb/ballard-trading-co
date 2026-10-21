import {conditionChoices} from './listing-controls.mjs';

// A season is identified card data, not a missing year. Keep its first year for eBay.
export function cardYear(value){
 const text=String(value??'').trim(),match=text.match(/^(18\d{2}|19\d{2}|20\d{2}|2100)(?:\s*[-–—/]\s*(\d{2}|\d{4}))?$/);
 if(!match)return '';
 const year=Number(match[1]);
 if(match[2]&&Number(match[2])!==(match[2].length===2?(year+1)%100:year+1))return '';
 return String(year);
}
export function identifiedYear(d){
 if(String(d.year??'').trim())return cardYear(d.year);
 const assessed=cardYear(d.preparation?.result?.year);if(assessed)return assessed;
 const years=new Set();
 for(const text of [d.title,d.setName])for(const match of String(text??'').matchAll(/(?<![\d/#])(18\d{2}|19\d{2}|20\d{2}|2100)(?:\s*[-–—/]\s*(\d{2}|\d{4}))?(?!\d)/g)){const year=cardYear(match[0]);if(year)years.add(year);}
 return years.size===1?[...years][0]:'';
}
export const currentCardYear=()=>Number(new Intl.DateTimeFormat('en-US',{year:'numeric',timeZone:'America/Los_Angeles'}).format(new Date()));
export function cardDefaults(d,currentYear=currentCardYear()){
 const fields={};if(d.kind!=='card'||!d.title?.trim()||!d.subject?.trim()||!d.setName?.trim())return {fields};
 const year=identifiedYear(d);if(year&&String(d.year??'')!==year)fields.year=year;
 const choice=conditionChoices(d),manual=d.conditionChoice?.source==='owner'&&d.conditionChoice.value===d.condition;
 // Preserve earlier explicit dropdown choices too; AI-applied/legacy labels get the new defaults.
 const legacyManual=!d.conditionChoice&&choice.value&&d.preparation?.applied?.condition!==d.condition;
 if(d.gradeCompany||manual||legacyManual)return {fields};
 const hoodys=/\bhoody(?:['’]s|s)?\b/i.test([d.vendor,d.acquisitionRef].filter(Boolean).join(' '));
 const recent=Boolean(year)&&Number(year)<=currentYear&&currentYear-Number(year)<3;
 const value=hoodys||recent?'Near mint or better':'Very good',rule=hoodys?'Hoody’s':recent?'Less than 3 years old':'Older or unknown year';
 if(d.condition!==value)fields.condition=value;
 return {fields,condition:{source:'default',value,rule}};
}
