import {photoSize} from './vision.mjs?v=0.11.1';
export async function preparePhoto(file){
  if(!file||file.size>25*1024*1024||!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)&&!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file.type)||file.type==='image/svg+xml')throw Error('Choose a camera photo, JPEG, PNG, WebP or supported HEIC image under 25 MB.');
  const url=URL.createObjectURL(file),img=new Image();
  try{
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Your browser could not open this photo. Retake it using the camera or choose JPEG.'));img.src=url;});
    const size=photoSize(img.naturalWidth,img.naturalHeight),canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
    const context=canvas.getContext('2d');if(!context)throw Error('Photo preparation is unavailable in this browser.');context.fillStyle='#fff';context.fillRect(0,0,size.width,size.height);context.drawImage(img,0,0,size.width,size.height);
    let blob;for(const quality of [0.9,0.78,0.65]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=3*1024*1024)break;}
    if(!blob||blob.size>3*1024*1024)throw Error('This photo is still too large. Retake it with only the card in frame.');
    return {blob,...size,originalBytes:file.size,bytes:blob.size};
  }finally{URL.revokeObjectURL(url);}
}
export async function encodePhoto(photo){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Photo could not be read.'));reader.onload=()=>resolve({mime:photo.blob.type,data:String(reader.result).split(',')[1]});reader.readAsDataURL(photo.blob);});}
