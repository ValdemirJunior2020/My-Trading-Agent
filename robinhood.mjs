// Official MCP connection probe. Only discovery and allowlisted public market tools.
// No brokerage account, portfolio, or order tools can be called through this module.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {UnauthorizedError} from '@modelcontextprotocol/sdk/client/auth.js';
import http from 'node:http';
import {createVault} from './oauth-vault.mjs';
const endpoint='https://agent.robinhood.com/mcp/trading';
export const allowed=new Set(['get_equity_quotes','get_equity_historicals','get_equity_price_book','get_equity_fundamentals','get_index_historicals','get_index_quotes']);
export async function marketCall(client,name,args){if(!allowed.has(name))throw Error('Blocked: not an approved market data tool');return client.callTool({name,arguments:args})}
export async function connectRobinhood(){
 const vault=createVault(),saved=vault.load();
 let {info,tokens}=saved;let verifier,authUrl;const state=crypto.randomUUID();
 const persist=()=>{try{vault.save({info,tokens})}catch{console.warn('Encrypted session could not be saved; future login may be required.')}};
 if(tokens)console.log('Trying encrypted saved Robinhood session…');
 const redirectUrl='http://127.0.0.1:8791/callback';
 const provider={redirectUrl,clientMetadata:{redirect_uris:[redirectUrl],client_name:'THE LION market research',grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'},state:()=>state,clientInformation:()=>info,saveClientInformation:v=>{info=v;persist()},tokens:()=>tokens,saveTokens:v=>{tokens=v;persist()},redirectToAuthorization:u=>{authUrl=u},saveCodeVerifier:v=>{verifier=v},codeVerifier:()=>verifier,invalidateCredentials:scope=>{if(scope==='all'||scope==='tokens')tokens=undefined;if(scope==='all'||scope==='client')info=undefined;if(scope==='all'||scope==='verifier')verifier=undefined;persist()}};
 const client=new Client({name:'the-lion-research',version:'0.2.0'});const transport=new StreamableHTTPClientTransport(new URL(endpoint),{authProvider:provider});
 try{await client.connect(transport)}catch(e){if(!(e instanceof UnauthorizedError)||!authUrl)throw Error('Robinhood connection failed before authorization. Check official setup.');const code=await new Promise((resolve,reject)=>{const server=http.createServer((req,res)=>{const u=new URL(req.url,redirectUrl);if(u.pathname!=='/callback'||u.searchParams.get('state')!==state){res.writeHead(400);return res.end('Invalid callback')}const c=u.searchParams.get('code');res.end(c?'Authorization received. Return to terminal.':'Authorization denied.');server.close();clearTimeout(timer);c?resolve(c):reject(Error('Authorization denied'))});const timer=setTimeout(()=>{server.close();reject(Error('Authorization timed out'))},1800000);server.on('error',()=>{clearTimeout(timer);reject(Error('Callback port unavailable'))});server.listen(8791,'127.0.0.1',()=>console.log('Review permissions first. Only continue if acceptable. Open this URL:\n'+authUrl.toString()))});await transport.finishAuth(code);await client.close();await client.connect(new StreamableHTTPClientTransport(new URL(endpoint),{authProvider:provider}))}
 console.log(vault.persistent?'Robinhood session ready; Windows encrypted storage enabled.':'Robinhood session ready; memory only on this platform.');
 return client;
}
async function main(){if(process.argv.includes('--forget')){createVault().clear();console.log('Local saved credentials cleared. Revoke access in Robinhood separately if desired.');return}const client=await connectRobinhood();
 const list=await client.listTools();console.log(JSON.stringify(list.tools.filter(t=>allowed.has(t.name)).map(t=>({name:t.name,inputSchema:t.inputSchema})),null,2));if(process.argv.includes('--sample')){
 const end=new Date(),start=new Date(end.getTime()-6*60*60*1000);
 for(const [name,args] of [['get_equity_quotes',{symbols:['PINS','SPY']}],['get_equity_historicals',{symbols:['PINS'],start_time:start.toISOString(),end_time:end.toISOString(),interval:'5minute',bounds:'regular',adjustment_type:'none'}],['get_equity_price_book',{symbols:['PINS']}]]){
 if(!list.tools.some(t=>t.name===name))continue;
 try{const result=await marketCall(client,name,args);console.log('MARKET SAMPLE '+name+' '+JSON.stringify(result).slice(0,18000))}catch(e){console.log('MARKET SAMPLE FAILED '+name+' '+e.name)}
 }
 }
 console.log('Market data only. No accounts or orders accessed.');await client.close();
}
if(process.argv[1]&&new URL(import.meta.url).pathname.endsWith('/'+process.argv[1].split(/[\\/]/).pop()))main().catch(()=>{console.error('Robinhood probe failed or authorization was not completed. No orders submitted.');process.exitCode=1});
