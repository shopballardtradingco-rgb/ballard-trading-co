import {validateListingPages} from './ebay-api-refresh.mjs';
// Transport is injected by an authenticated server/worker adapter, never a browser token.
export async function collectListingPages(fetchPage,scope){
  const pages=[];let next=1;
  while(next!==null){
    if(!Number.isSafeInteger(next)||next!==pages.length+1||next>125)throw Error('Invalid listing pagination.');
    const page=await fetchPage(next);
    if(!page||page.page!==next||page.total_matching>=25000)throw Error('Unsupported listing response.');
    if(pages.length&&(page.total_matching!==pages[0].total_matching||page.total_pages!==pages[0].total_pages))throw Error('Listings changed during collection; restart from page 1.');
    pages.push(page);next=page.next_page;
  }
  const snapshot=await validateListingPages(pages,scope);
  return {pages,snapshot};
}
