'use client';
import {useEffect} from 'react';
export default function VaultClient({userId}:{userId:string}){
  useEffect(()=>{
    const script=document.createElement('script');script.type='module';script.src='/app.mjs?v=0.11.4';document.body.appendChild(script);
    return ()=>{script.remove();};
  },[]);
  return <><a className="skip" href="#main">Skip to inventory</a><div id="app" data-owner={userId}><div className="loading">Opening your shared Vault…</div></div><dialog id="modal" aria-labelledby="modal-title"/><div id="toast" role="status" aria-live="polite"/></>;
}
