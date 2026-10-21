// Asking prices only. Costs, fees, sale receipts and source comps keep cents.
// Keep invalid input unchanged so the existing validators reject it.
export const roundAskingCents=value=>Number.isSafeInteger(value)&&value>=0?Math.round(value/100)*100:value;
