import http from 'node:http';
import {readFile} from 'node:fs/promises';
const port = Number(process.env.PORT || 4179);
http.createServer(async(req,res)=>{
  if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
  try {const html=await readFile(new URL('./Sumo Cars.html',import.meta.url));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}
  catch {res.writeHead(503);res.end('Run npm run build first.');}
}).listen(port,'127.0.0.1',()=>console.log(`Sumo Cars: http://127.0.0.1:${port}`));
