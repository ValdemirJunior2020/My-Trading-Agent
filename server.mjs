import http from 'node:http';
import {readFile} from 'node:fs/promises';
const routes={'/':['index.html','text/html'],'/app.mjs':['app.mjs','text/javascript'],'/risk.mjs':['risk.mjs','text/javascript'],'/style.css':['style.css','text/css']};
http.createServer(async(req,res)=>{
 const route=routes[req.url]; if(req.method!=='GET'||!route){res.writeHead(404);return res.end('Not found');}
 try{const data=await readFile(new URL(route[0],import.meta.url));res.writeHead(200,{'Content-Type':route[1]+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; object-src 'none'; frame-ancestors 'none'"});res.end(data);}catch{res.writeHead(500);res.end('Unavailable');}
}).listen(8788,'127.0.0.1',()=>console.log('THE LION: http://127.0.0.1:8788'));
