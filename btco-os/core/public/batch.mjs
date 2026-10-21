// Files stay in this tab until uploaded. Completed work is always saved server-side.
export const MAX_BATCH_PHOTOS=500;
export class BatchIntake {
 constructor({save,upload,onChange}){Object.assign(this,{save,upload,onChange});this.items=[];this.running=false;this.pauseRequested=false;}
 get unfinished(){return this.items.some(item=>item.status!=='saved');}
 get started(){return this.items.some(item=>item.draftId||item.status!=='waiting');}
 get photoCount(){return this.items.reduce((n,item)=>n+item.files.length,0);}
 get pendingBytes(){return this.items.reduce((n,item)=>n+item.files.reduce((m,entry)=>m+(item.uploaded.includes(entry.role)?0:entry.file.size),0),0);}
 validate(files,mode,existingCount=0){
  if(this.running||this.started)throw Error('Clear the current queue before adding another batch. Saved drafts stay in Intake.');
  if(!['single','paired'].includes(mode))throw Error('Choose fronts only or front/back pairs.');
  if(!files.length)throw Error('Choose at least one photo.');
  if(mode==='paired'&&files.length%2!==0)throw Error('Choose an even number of photos: front, back, front, back. No photos were added.');
  if(existingCount+files.length>MAX_BATCH_PHOTOS)throw Error('Choose up to 500 photos per queue.');
  if(files.some(file=>!file.size||file.size>12*1024*1024))throw Error('Each original must be nonempty and 12 MB or smaller.');
 }
 setFiles(files,mode='paired'){this.validate(files,mode);this.clear();this.addFiles(files,mode);}
 addFiles(files,mode='paired'){
  this.validate(files,mode,this.photoCount);
  const stride=mode==='single'?1:2;
  for(let i=0;i<files.length;i+=stride)this.items.push({id:crypto.randomUUID(),files:files.slice(i,i+stride).map((file,index)=>({file,role:index===0?'front':'back',url:URL.createObjectURL(file)})),draftId:null,uploaded:[],status:'waiting',error:''});
  this.onChange();
 }
 swap(id){if(this.started||this.running)return;const item=this.items.find(item=>item.id===id);if(item?.files.length===2){item.files.reverse();item.files.forEach((entry,i)=>entry.role=i===0?'front':'back');}this.onChange();}
 remove(id){if(this.started||this.running)return;const item=this.items.find(item=>item.id===id);if(item)for(const entry of item.files)URL.revokeObjectURL(entry.url);this.items=this.items.filter(item=>item.id!==id);this.onChange();}
 clear(){if(this.running)return;for(const item of this.items)for(const file of item.files)URL.revokeObjectURL(file.url);this.items=[];this.pauseRequested=false;this.details=null;}
 pause(){this.pauseRequested=true;this.onChange();}
 async start(details){
  if(this.running||!this.unfinished)return;
  this.details??={...details};this.running=true;this.pauseRequested=false;this.onChange();
  try{
   for(const item of this.items){
    if(item.status==='saved')continue;if(this.pauseRequested)break;
    item.status='saving';item.error='';this.onChange();
    try{
     if(!item.draftId){const result=await this.save('/drafts',this.details);item.draftId=result.draftId;}
     for(const [index,entry] of item.files.entries()){
      const role=entry.role;
      if(item.uploaded.includes(role))continue;
      await this.upload(item.draftId,role,item.files[index].file);item.uploaded.push(role);this.onChange();
     }
     item.status='saved';
    }catch(error){item.status='error';item.error=error.message;this.pauseRequested=true;}
    this.onChange();
   }
  }finally{this.running=false;this.onChange();}
 }
}

