const {timingSafeEqual}=require('node:crypto');
function visionAccess(token){
  return (req,res,next)=>{
    if(!token)return next(); // Tokenless operation is restricted to loopback by server.cjs.
    const received=Buffer.from(req.headers.authorization||'');
    const expected=Buffer.from('Bearer '+token);
    if(received.length!==expected.length||!timingSafeEqual(received,expected))return res.status(401).json({success:false,error:'Vision service authorization required.'});
    next();
  };
}
function listenHost(env){
  const host=env.HOST||'127.0.0.1';
  if(!['127.0.0.1','::1','localhost'].includes(host)&&!env.VISION_SERVICE_TOKEN)throw Error('Set VISION_SERVICE_TOKEN before allowing network access.');
  return host;
}
module.exports={visionAccess,listenHost};
