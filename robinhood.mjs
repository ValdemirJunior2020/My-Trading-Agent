// Official MCP connection probe. Only discovery and allowlisted public market tools.
// No brokerage account, portfolio, or order tools can be called through this module.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {UnauthorizedError} from '@modelcontextprotocol/sdk/client/auth.js';
import http from 'node:http';
const endpoint='https://agent.robinhood.com/mcp/trading';
export const allowed=new Set(['get_equity_quotes','get_equity_historicals','get_equity_news','get_market_hours','get_equity_instruments','get_index_historicals']);
export async function marketCall(client,name,args){if(!allowed.has(name))throw Error('Blocked: not an approved market data tool');return client.callTool({name,arguments:args})}
async function main(){
 // Credentials and OAuth tokens are kept in process memory; never written to Git or logs.
 let info,tokens,verifier,authUrl;const state=crypto.randomUUID();
 const redirectUrl='http://127.0.0.1:8791/callback';
 const provider={redirectUrl,clientMetadata:{redirect_uris:[redirectUrl],client_name:'THE LION market research',grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'},state:()=>state,clientInformation:()=>info,saveClientInformation:v=>{info=v},tokens:()=>tokens,saveTokens:v=>{tokens=v},redirectToAuthorization:u=>{authUrl=u},saveCodeVerifier:v=>{verifier=v},codeVerifier:()=>verifier,invalidateCredentials:scope=>{if(scope==='all'||scope==='tokens')tokens=undefined;if(scope==='all'||scope==='client')info=undefined;if(scope==='all'||scope==='verifier')verifier=undefined}};
 const client=new Client({name:'the-lion-research',version:'0.2.0'});const transport=new StreamableHTTPClientTransport(new URL(endpoint),{authProvider:provider});
 try{await client.connect(transport)}catch(e){if(!(e instanceof UnauthorizedError)||!authUrl)throw Error('Robinhood connection failed before authorization. Check official setup.');const code=await new Promise((resolve,reject)=>{const server=http.createServer((req,res)=>{const u=new URL(req.url,redirectUrl);if(u.pathname!=='/callback'||u.searchParams.get('state')!==state){res.writeHead(400);return res.end('Invalid callback')}const c=u.searchParams.get('code');res.end(c?'Authorization received. Return to terminal.':'Authorization denied.');server.close();clearTimeout(timer);c?resolve(c):reject(Error('Authorization denied'))});const timer=setTimeout(()=>{server.close();reject(Error('Authorization timed out'))},300000);server.on('error',()=>{clearTimeout(timer);reject(Error('Callback port unavailable'))});server.listen(8791,'127.0.0.1',()=>console.log('Review permissions first. Only continue if acceptable. Open this URL:\n'+authUrl.toString()))});await transport.finishAuth(code);await client.connect(transport)}
 const list=await client.listTools();console.log(JSON.stringify(list.tools.filter(t=>allowed.has(t.name)).map(t=>({name:t.name,inputSchema:t.inputSchema})),null,2));console.log('Discovery only. No accounts or orders accessed.');await client.close();
}
if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith('/'+process.argv[1].split(/[\\/]/).pop()))main().catch(()=>{console.error('Robinhood probe failed or authorization was not completed. No orders submitted.');process.exitCode=1});
