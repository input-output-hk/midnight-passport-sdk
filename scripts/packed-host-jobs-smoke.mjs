/** Real loopback client/service consumption from installed tarballs. Chain drivers are fake;
 * no proof, image, provider or actual-registry qualification is inferred. */
export const packedHostJobsSmoke = String.raw`
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostMutationExecutor, createHostMutationJobs, encryptedHostMutationStore,
 encryptedHostJobStore, hostJobRoute, createServer, hostJobId } from '@input-output-hk/mn-passport-service';
import { remoteHostJobPorts, remoteHostJobs, remoteHostJobId } from '@input-output-hk/mn-passport-adapter-service';
const root=await mkdtemp(join(tmpdir(),'packed-host-jobs-'));
const h=encryptedHostMutationStore(join(root,'host'),new Uint8Array(32).fill(1)),
 j=encryptedHostJobStore(join(root,'jobs'),new Uint8Array(32).fill(2));
const pins={networkId:'undeployed',bindingId:'acc-s3r1.1',manifestSha256:'77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f'};
let sends=0;const receipts=new Set();
const executor=createHostMutationExecutor(h,{
 prepare:async(i)=>({address:'ab'.repeat(32),steps:i.kind==='deploy'?2:1,context:{}}),
 prepareStep:async(r,index)=>({tx:'01',identifiers:[r.identity.requestId.slice(0,32).padEnd(62,'0')+String(index).padStart(2,'0')]}),
 submit:async(tx)=>{sends++;const id=tx.identifiers[0];assert.ok(!receipts.has(id));receipts.add(id);return id;},
 lookup:async(tx)=>receipts.has(tx.identifiers[0])?{identifier:tx.identifiers[0],txHash:'ef'.repeat(32),succeeded:true}:undefined,
 check:async()=>true,
});
const jobs=createHostMutationJobs(j,executor,{pins});const token='33'.repeat(32);
const server=createServer({host:'127.0.0.1',corsOrigin:'http://localhost:5173'},[hostJobRoute({jobs,pins,token:Buffer.from(token,'hex')})]);
try{
 await new Promise((r)=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 let n=0;
 for(const scheme of ['p256-webauthn','jubjub-schnorr']){
  const p={...pins,scheme},options={pins:p,token,timeoutMs:5000,pollIntervalMs:1},ports=remoteHostJobPorts(base,options),client=remoteHostJobs(base,options);
  const deploy={requestId:(++n).toString(16).padStart(32,'0')+':0',intentSha256:'aa'.repeat(32)};
  const deployed=await ports.deployer.deploy({boot:new Uint8Array(32),encKey:new Uint8Array(32),retireAuthority:true,firstArm:scheme==='p256-webauthn'?'p256':'jubjub',mutation:deploy});
  assert.equal(deployed.txIds.length,2);
  const call={requestId:(++n).toString(16).padStart(32,'0')+':0',intentSha256:'bb'.repeat(32)};
  await ports.submitter.submit(Uint8Array.of(1),{address:deployed.address,circuit:scheme==='p256-webauthn'?'append_inbox_with_p256':'append_inbox_with_jubjub',mutation:call});
  const i={pins:p,kind:'call',...call};
  assert.equal(await remoteHostJobId(i),hostJobId({version:1,identity:i,input:{address:deployed.address,circuit:'append_inbox_with_jubjub',tx:'01'}}));
  const before=sends;assert.equal((await client.resume(i)).state,'done');assert.equal(sends,before);
  const outcome=await ports.outcomes.reconcile(p,{key:call.requestId,digest:call.intentSha256,kind:'call',input:{}});assert.equal(outcome.kind,'confirmed');
 }
 assert.equal(sends,6);
 console.log('packed host jobs: both arms, call/deploy, encrypted journals, real HTTP, no duplicate sends (synthetic chain)');
}finally{
 jobs.stopAdmission();await jobs.drain();await new Promise((r)=>{server.close(r);server.closeAllConnections();});j.close();h.close();await rm(root,{recursive:true,force:true});
}
`;
