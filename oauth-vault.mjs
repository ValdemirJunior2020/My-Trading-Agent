import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const script=String.raw`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$raw=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$scope=[System.Security.Cryptography.DataProtectionScope]::CurrentUser
if($env:LION_VAULT_OPERATION -eq 'protect'){$out=[System.Security.Cryptography.ProtectedData]::Protect($raw,$null,$scope)}
else{$out=[System.Security.Cryptography.ProtectedData]::Unprotect($raw,$null,$scope)}
[Console]::Write([Convert]::ToBase64String($out))`;
function crypt(operation,input){const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:Buffer.from(input).toString('base64'),encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,LION_VAULT_OPERATION:operation}});if(r.status!==0||!r.stdout?.trim())throw Error('Windows credential encryption unavailable');return Buffer.from(r.stdout.trim(),'base64')}
export function createVault(){if(process.platform!=='win32'||!process.env.LOCALAPPDATA)return {load:()=>({}),save:()=>{},clear:()=>{},persistent:false};const dir=join(process.env.LOCALAPPDATA,'NexusTradingLion'),file=join(dir,'robinhood.dpapi');return {persistent:true,load(){try{return JSON.parse(crypt('unprotect',readFileSync(file)).toString('utf8'))}catch(e){if(e.code!=='ENOENT')console.warn('Saved Robinhood session could not be read; reauthorization may be necessary.');return {}}},save(value){mkdirSync(dir,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{writeFileSync(temp,crypt('protect',Buffer.from(JSON.stringify(value))),{flag:'wx'});renameSync(temp,file)}finally{try{unlinkSync(temp)}catch{}}},clear(){try{unlinkSync(file)}catch(e){if(e.code!=='ENOENT')throw e}}}}
