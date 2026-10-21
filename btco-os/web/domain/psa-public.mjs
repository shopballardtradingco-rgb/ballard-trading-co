// Public research links only. Opening a page never confirms or changes a card.
export function psaPublicLinks(value){
  if(typeof value!=='string')return null;
  const cert=value.trim();
  if(!/^[0-9]{5,12}$/.test(cert))return null;
  return {
    cert,
    official:`https://www.psacard.com/cert/${cert}/psa`,
    google:`https://www.google.com/search?q=${encodeURIComponent(`site:psacard.com/cert/ "${cert}"`)}`
  };
}
