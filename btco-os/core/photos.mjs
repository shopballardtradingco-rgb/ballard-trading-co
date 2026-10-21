import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {hash,fail} from './domain.mjs';
export const MAX_PHOTO=12*1024*1024;
export const DATABASE_PHOTO_STORAGE=64*1024*1024;
export const MAX_PHOTO_STORAGE=10*1024*1024*1024;
export async function inspectPhoto(bytes,{filename,role}){
 if(!['front','back'].includes(role))fail('Choose front or back.');
 if(typeof filename!=='string'||!filename.length||filename.length>180||/[\x00-\x1f/\\]/.test(filename))fail('Use a simple image filename.');
 if(!bytes.length||bytes.length>MAX_PHOTO)fail('Each original must be 12 MB or smaller.',413);
 let metadata,preview;
 try{
  const source=sharp(bytes,{limitInputPixels:40_000_000,failOn:'error',animated:false});metadata=await source.metadata();
  if(!['jpeg','png','webp','heif'].includes(metadata.format)||(metadata.pages??1)!==1)fail('Upload a single JPEG, PNG, WebP, or supported HEIC image.');
  if(metadata.width<100||metadata.height<100)fail('Use an original at least 100 pixels on each side.');
  preview=await source.rotate().resize(800,800,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
 }catch(e){if(e.status)throw e;fail('This image could not be decoded. Export a JPEG or PNG and try again.');}
 return {id:randomUUID(),role,filename,mediaType:({jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heif:'image/heic'})[metadata.format],sha256:hash(bytes),sizeBytes:bytes.length,width:metadata.width,height:metadata.height,createdAt:new Date().toISOString(),preview};
}
