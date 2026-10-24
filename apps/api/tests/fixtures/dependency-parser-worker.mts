import express from 'express';

// A separate process keeps a parser crash from terminating the whole suite.
// Same Express JSON parser/options as the API's general JSON boundary; no DB.
const app=express();
app.get('/health',(_req,res)=>res.json({ok:true}));
app.use(express.json({limit:'5mb'}));
app.post('/parser',(req,res)=>{
  const pipes=(req as unknown as {_readableState:{pipes:Array<{constructor:{name:string}}>}})._readableState.pipes;
  const lingeringDecoders=pipes.filter(p=>['Inflate','Gunzip','BrotliDecompress'].includes(p.constructor.name)).length;
  process.send?.({parsed:true,lingeringDecoders});
  // A downstream consumer must still be able to wait for the complete request.
  const finish=()=>res.json(req.body);
  if(req.readableEnded)finish();else req.once('end',finish);
});
const server=app.listen(0,'127.0.0.1',()=>{
  const address=server.address();
  if(!address||typeof address==='string')throw Error('Missing loopback address');
  process.send?.({port:address.port});
});
process.on('message',message=>{if(message==='stop'){server.closeAllConnections();server.close(()=>process.exit(0));}});
