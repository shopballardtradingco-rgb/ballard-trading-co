// Shared by the browser and server. Back photos are optional for every card.
export const DEFAULT_CHEAP_CARD_CENTS = 500; // Legacy saved field; no longer controls card photos.
export function photoRequirement(d) {
 return d.kind==='card'
  ? {roles:['front'],reason:'One front photo is enough for any card; back photos are optional'}
  : {roles:['front','back'],reason:'Front and back required'};
}
export function missingPhotos(d) {return photoRequirement(d).roles.filter(role=>!(d.photos??[]).some(p=>p.role===role));}
